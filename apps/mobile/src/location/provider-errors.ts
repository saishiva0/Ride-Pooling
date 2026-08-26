/**
 * Provider failure normalization (Phase 3.20 — GOOGLE MAPS & LOCATION
 * INTEGRATION).
 *
 * Every Google/device-location provider failure is normalized to the existing
 * `MobileError` taxonomy (`src/api/errors.ts`) at the infrastructure boundary —
 * raw vendor exceptions, HTTP statuses, and native module throws never leak
 * into screens, hooks, or the domain. This mirrors the backend Phase 3.12
 * posture where vendor errors are wrapped in `RoutingProviderError` /
 * `GeocodingProviderError` (502, not exposed) and never leak.
 *
 * The Google Geocoding API and Routes API return an explicit `status`/`error`
 * code on non-OK responses; those codes map to the closest existing `MobileErrorKind`
 * so consumers get a consistent, actionable failure without vendor detail.
 */
import { MobileError, type MobileErrorKind } from '../api/errors';

export const GOOGLE_MAPS_PROVIDER_ID = 'google-maps';

/** Non-OK statuses the Google Geocoding API can return (subset used here). */
export type GoogleGeocodeStatus =
  | 'OK'
  | 'ZERO_RESULTS'
  | 'OVER_QUERY_LIMIT'
  | 'REQUEST_DENIED'
  | 'INVALID_REQUEST'
  | 'UNKNOWN_ERROR';

/** Non-OK error codes the Google Routes API can return (subset used here). */
export type GoogleRoutesErrorCode =
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'INVALID_ARGUMENT'
  | 'FAILED_PRECONDITION'
  | 'RESOURCE_EXHAUSTED'
  | 'INTERNAL'
  | 'UNAVAILABLE';

const GEOCODE_STATUS_KIND: Partial<
  Record<GoogleGeocodeStatus, MobileErrorKind>
> = {
  OVER_QUERY_LIMIT: 'rate-limited',
  REQUEST_DENIED: 'permission-denied',
  INVALID_REQUEST: 'validation',
  UNKNOWN_ERROR: 'external-service',
};

const ROUTES_CODE_KIND: Partial<
  Record<GoogleRoutesErrorCode, MobileErrorKind>
> = {
  PERMISSION_DENIED: 'permission-denied',
  INVALID_ARGUMENT: 'validation',
  FAILED_PRECONDITION: 'external-service',
  RESOURCE_EXHAUSTED: 'rate-limited',
  INTERNAL: 'external-service',
  UNAVAILABLE: 'external-service',
  NOT_FOUND: 'not-found',
};

/**
 * Maps a Google Geocoding API status to the closest existing `MobileErrorKind`
 * (falling back to `external-service`).
 */
export function geocodeStatusKind(status: string): MobileErrorKind {
  return (
    GEOCODE_STATUS_KIND[status as GoogleGeocodeStatus] ?? 'external-service'
  );
}

/**
 * Maps a Google Routes API error code to the closest existing
 * `MobileErrorKind` (falling back to `external-service`).
 */
export function routesErrorKind(code: string): MobileErrorKind {
  return ROUTES_CODE_KIND[code as GoogleRoutesErrorCode] ?? 'external-service';
}

/**
 * Builds a normalized `MobileError` for a Google provider failure. The message
 * stays vendor-neutral ("Maps service is unavailable") — provider-specific
 * detail is retained only in `details` for diagnostics, matching the Phase
 * 3.12 guidance that vendor details never reach API responses or logs
 * unintentionally.
 */
export function googleProviderError(
  kind: MobileErrorKind,
  message: string,
  options: { status?: string; code?: string; cause?: unknown } = {},
): MobileError {
  return new MobileError(kind, message, {
    cause: options.cause,
    details: {
      provider: GOOGLE_MAPS_PROVIDER_ID,
      ...(options.status ? { status: options.status } : {}),
      ...(options.code ? { code: options.code } : {}),
    },
  });
}
