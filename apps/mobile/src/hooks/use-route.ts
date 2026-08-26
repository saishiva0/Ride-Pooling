/**
 * `useRoute` hook (Phase 3.20 — GOOGLE MAPS & LOCATION INTEGRATION).
 *
 * The minimal reusable bridge between screens/components and the
 * provider-neutral `RoutingProvider` port. Exposes a single `RouteResult`
 * through the `AsyncState` model, keyed by the origin/destination pair:
 *
 * - identical requests are de-duplicated (a request already in flight for the
 *   same pair is ignored — no wasted provider calls)
 * - the result only updates for the LATEST request (out-of-order responses are
 *   dropped)
 * - every failure is a normalized `MobileError`
 *
 * The provider is injected (tests use fakes); with the fail-closed provider
 * every call surfaces a normalized `external-service` error.
 */
import { useCallback, useRef, useState } from 'react';
import { toMobileError } from '../api/errors';
import type { RouteResult } from '../location/location.types';
import type { RoutingProvider } from '../location/routing';
import { idleAsyncState, type AsyncState } from '../state/async';

export interface UseRouteResult {
  state: AsyncState<RouteResult>;
  /** Calculates the route between origin and destination (deduplicated). */
  calculateRoute: (
    origin: {
      latitude: number;
      longitude: number;
    },
    destination: {
      latitude: number;
      longitude: number;
    },
  ) => Promise<void>;
}

function requestKey(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
): string {
  return `${origin.latitude},${origin.longitude}->${destination.latitude},${destination.longitude}`;
}

export function useRoute(provider: RoutingProvider): UseRouteResult {
  const [state, setState] = useState<AsyncState<RouteResult>>(idleAsyncState);
  const inFlightKey = useRef<string | null>(null);
  const latestKey = useRef<string | null>(null);

  const calculateRoute = useCallback(
    async (
      origin: { latitude: number; longitude: number },
      destination: { latitude: number; longitude: number },
    ): Promise<void> => {
      const key = requestKey(origin, destination);
      latestKey.current = key;
      if (inFlightKey.current === key) {
        // Already resolving this exact pair; the in-flight response will land
        // on this key.
        return;
      }
      inFlightKey.current = key;
      setState({ status: 'loading' });
      try {
        const result = await provider.calculateRoute({ origin, destination });
        if (latestKey.current === key) {
          setState({ status: 'success', data: result });
        }
      } catch (err) {
        if (latestKey.current === key) {
          setState({ status: 'error', error: toMobileError(err) });
        }
      } finally {
        if (inFlightKey.current === key) {
          inFlightKey.current = null;
        }
      }
    },
    [provider],
  );

  return { state, calculateRoute };
}
