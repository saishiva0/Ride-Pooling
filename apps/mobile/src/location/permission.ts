/**
 * Mobile location permission model (Phase 3.16 — MOBILE LOCATION, GPS & MAPS
 * FOUNDATION).
 *
 * An explicit, deterministic permission state machine. Permission denial is a
 * normal state, never a crash. The states are:
 *
 *   unknown   → nothing known yet (initial; before the client reports)
 *   requesting→ a permission request is in flight
 *   granted   → the device/location capability is permitted
 *   denied    → the user (or the platform) denied permission
 *   unavailable → the capability does not exist (no GPS, unsupported platform,
 *                 or no location provider configured — fail closed)
 *
 * The `LocationClient` port and `useCurrentLocation` hook drive transitions;
 * the UI only ever renders deterministic states. Message text is minimal,
 * product-copy-light, and never exposes raw native detail.
 */

export type LocationPermissionStatus =
  'unknown' | 'requesting' | 'granted' | 'denied' | 'unavailable';

export function isLocationPermissionGranted(
  status: LocationPermissionStatus,
): status is 'granted' {
  return status === 'granted';
}

export function isLocationPermissionDenied(
  status: LocationPermissionStatus,
): status is 'denied' {
  return status === 'denied';
}

export function isLocationPermissionUnavailable(
  status: LocationPermissionStatus,
): status is 'unavailable' {
  return status === 'unavailable';
}

/**
 * A stable, user-understandable message for non-granted permission states, or
 * `null` when nothing needs to be shown. Denial/unavailability explicitly
 * point the user back at the manual coordinate flow so discovery is never
 * blocked by a missing permission.
 */
export function locationPermissionMessage(
  status: LocationPermissionStatus,
): string | null {
  switch (status) {
    case 'denied':
      return 'Location permission was denied. You can still enter coordinates manually.';
    case 'unavailable':
      return 'Location is not available on this device. You can still enter coordinates manually.';
    case 'requesting':
      return 'Requesting location permission…';
    case 'unknown':
    case 'granted':
      return null;
    default:
      return null;
  }
}
