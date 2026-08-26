/**
 * Mobile location acquisition state (Phase 3.16 — MOBILE LOCATION, GPS & MAPS
 * FOUNDATION).
 *
 * Represents getting a coordinate INDEPENDENTLY of permission state:
 *
 *   idle      → nothing requested yet
 *   requesting→ a current-location request is in flight (on-demand only;
 *               never a background/continuous subscription)
 *   success   → a validated WGS84 coordinate was obtained
 *   error     → acquisition failed; the error is a normalized `MobileError`
 *               (native exceptions, stack traces, and provider internals never
 *               reach the UI)
 *
 * Success ALWAYS carries a validated coordinate: the hook validates through
 * the authoritative mobile coordinate rules (`coordinate.ts`) before entering
 * `success`, so an invalid/NaN/Infinity reading becomes an error instead of a
 * fake position.
 */
import type { MobileError } from '../api/errors';
import type { Coordinate } from './location.types';

export type LocationState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'success'; coordinate: Coordinate }
  | { status: 'error'; error: MobileError };

export function isLocationIdle(
  state: LocationState,
): state is { status: 'idle' } {
  return state.status === 'idle';
}

export function isLocationRequesting(
  state: LocationState,
): state is { status: 'requesting' } {
  return state.status === 'requesting';
}

export function isLocationSuccess(
  state: LocationState,
): state is { status: 'success'; coordinate: Coordinate } {
  // Belt-and-suspenders: success must carry an actual coordinate object, never
  // a bare `{ status: 'success' }` (the union type prevents this statically,
  // but the guard refuses to render a fake position if one ever slips through).
  return (
    state.status === 'success' &&
    state.coordinate !== undefined &&
    state.coordinate !== null
  );
}

export function isLocationError(
  state: LocationState,
): state is { status: 'error'; error: MobileError } {
  return state.status === 'error';
}

/** A stable, user-understandable message for in-progress states (errors are
 * rendered through the normalized `mobileErrorMessage` model). */
export function locationAcquisitionMessage(
  state: LocationState,
): string | null {
  if (isLocationRequesting(state)) {
    return 'Getting your current location…';
  }
  return null;
}
