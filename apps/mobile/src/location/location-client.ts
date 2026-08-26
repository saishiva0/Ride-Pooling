/**
 * Mobile location client port (Phase 3.16 — MOBILE LOCATION, GPS & MAPS
 * FOUNDATION).
 *
 * The provider- and platform-independent boundary between screens and device
 * location. Screens MUST never call Expo Location, native location APIs,
 * browser geolocation, or map SDKs directly — they depend on this interface
 * (or the `useCurrentLocation` hook) and an injected implementation.
 *
 * Only the capability genuinely required this phase is on the port:
 *   - getPermissionState()  → current permission status
 *   - requestPermission()   → request permission (one-shot, deterministic)
 *   - getCurrentLocation()  → on-demand current coordinate (no background,
 *                             no continuous subscription/watching)
 *
 * `watchLocation` is deliberately NOT defined: continuous tracking, live
 * sharing, and background location are outside Phase 3.16.
 *
 * The default implementation (`unavailableLocationClient`) FAILS CLOSED: with
 * no device-location dependency approved (the repo has no `expo-location`
 * dependency, and a real adapter is only permitted once the supported Expo
 * package exists — Phase 3.16 §10), permission is `unavailable` and location
 * acquisition throws a normalized `MobileError`. It never fabricates a
 * coordinate, never infers location from the network, and never uses mock
 * GPS data. Tests inject fake implementations through this same interface.
 */
import { MobileError } from '../api/errors';
import type { Coordinate } from './location.types';
import type { LocationPermissionStatus } from './permission';

export interface LocationClient {
  /** The current permission status (never throws; fail-closed on error). */
  getPermissionState(): Promise<LocationPermissionStatus>;
  /** Requests permission once. Resolves the resulting status. */
  requestPermission(): Promise<LocationPermissionStatus>;
  /**
   * Obtains the device's current coordinate on demand. Rejects with a
   * normalized `MobileError` (permission/location unavailable, timeout,
   * native failure) — raw native exceptions never cross this boundary.
   */
  getCurrentLocation(): Promise<Coordinate>;
}

/** The default fail-closed client (no device-location capability exists yet). */
export const unavailableLocationClient: LocationClient = {
  async getPermissionState(): Promise<LocationPermissionStatus> {
    return 'unavailable';
  },
  async requestPermission(): Promise<LocationPermissionStatus> {
    return 'unavailable';
  },
  async getCurrentLocation(): Promise<Coordinate> {
    throw new MobileError(
      'location-unavailable',
      'Current location is unavailable (no device location provider is configured; OD-007 is open)',
      {
        details: { reason: 'unavailable-location-client' },
      },
    );
  },
};
