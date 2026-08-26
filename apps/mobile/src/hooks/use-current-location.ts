/**
 * `useCurrentLocation` hook (Phase 3.16 — MOBILE LOCATION, GPS & MAPS
 * FOUNDATION).
 *
 * The minimal reusable bridge between screens and the `LocationClient` port.
 * Responsibilities:
 *   - exposes permission state (initialized from `getPermissionState()`)
 *   - exposes location acquisition state (idle/requesting/success/error)
 *   - exposes the coordinate when available (always validated)
 *   - exposes a permission request and an on-demand location action
 *   - is completely independent of ride business logic — it never calls the
 *     ride API and knows nothing about discovery
 *
 * Determinism and safety guarantees:
 *   - acquisition is ON-DEMAND only: nothing runs on mount besides reading the
 *     permission state, and there is no polling, retry loop, or background
 *     subscription (a rejected request stays errored until the user acts)
 *   - a re-entrant request while one is in flight is ignored (no double GPS)
 *   - a coordinate is only ever surfaced after passing the authoritative
 *     mobile coordinate validation; NaN/±Infinity/out-of-range readings become
 *     a normalized `validation` error, never a fake position
 *   - every failure is a normalized `MobileError`; native detail never leaks
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { MobileError, toMobileError } from '../api/errors';
import { isValidCoordinate } from '../location/coordinate';
import type { LocationClient } from '../location/location-client';
import type { LocationPermissionStatus } from '../location/permission';
import type { Coordinate } from '../location/location.types';
import type { LocationState } from '../location/location-state';

export interface UseCurrentLocationResult {
  /** The current permission status (starts `unknown`, settles to the client's
   * reported status; fail-closed to `unavailable` on error). */
  permission: LocationPermissionStatus;
  /** Location acquisition state (idle → requesting → success | error). */
  state: LocationState;
  /** The validated coordinate when acquisition succeeded. */
  coordinate: Coordinate | null;
  /** Requests permission once; resolves the resulting status. */
  requestPermission: () => Promise<LocationPermissionStatus>;
  /** Acquires the current location on demand; resolves the validated
   * coordinate, or `null` when acquisition failed. Never retries on its own. */
  getCurrentLocation: () => Promise<Coordinate | null>;
}

export function useCurrentLocation(
  client: LocationClient,
): UseCurrentLocationResult {
  const [permission, setPermission] =
    useState<LocationPermissionStatus>('unknown');
  const [state, setState] = useState<LocationState>({ status: 'idle' });
  const inFlightRef = useRef(false);
  const permissionInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    client
      .getPermissionState()
      .then((status) => {
        if (!cancelled) {
          setPermission(status);
        }
      })
      .catch(() => {
        // Fail closed: an unknown capability is treated as unavailable.
        if (!cancelled) {
          setPermission('unavailable');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const requestPermission =
    useCallback(async (): Promise<LocationPermissionStatus> => {
      if (permissionInFlightRef.current) {
        return 'requesting';
      }
      permissionInFlightRef.current = true;
      setPermission('requesting');
      try {
        const status = await client.requestPermission();
        setPermission(status);
        return status;
      } catch {
        // Fail closed: an unexpected permission error is treated as
        // unavailable (never a fabricated grant).
        setPermission('unavailable');
        return 'unavailable';
      } finally {
        permissionInFlightRef.current = false;
      }
    }, [client]);

  const getCurrentLocation =
    useCallback(async (): Promise<Coordinate | null> => {
      if (inFlightRef.current) {
        return null;
      }
      inFlightRef.current = true;
      setState({ status: 'requesting' });
      try {
        const coordinate = await client.getCurrentLocation();
        if (!isValidCoordinate(coordinate)) {
          setState({
            status: 'error',
            error: new MobileError(
              'validation',
              'The location service returned an invalid coordinate',
              {
                field: 'coordinate',
                details: {
                  latitude: coordinate.latitude,
                  longitude: coordinate.longitude,
                },
              },
            ),
          });
          return null;
        }
        setState({ status: 'success', coordinate });
        return coordinate;
      } catch (err) {
        setState({ status: 'error', error: toMobileError(err) });
        return null;
      } finally {
        inFlightRef.current = false;
      }
    }, [client]);

  const coordinate = state.status === 'success' ? state.coordinate : null;

  return {
    permission,
    state,
    coordinate,
    requestPermission,
    getCurrentLocation,
  };
}
