/**
 * Provider-independent geocoding seam (Phase 3.12 — LOCATION & MAPS
 * FOUNDATION, §10, §20).
 *
 * The seam where a future geocoding provider (OD-007) plugs in, covering:
 *
 * - forward geocoding: human-readable place → coordinates
 * - reverse geocoding: coordinates → human-readable location
 *
 * OD-007 is OPEN: NO provider is selected, NO API keys, NO provider SDKs, NO
 * provider-specific environment variables, and NO network calls exist here.
 * Geocoding provider selection is explicitly deferred
 * (`docs/planning/open-decisions.md` OD-007); `docs/architecture/api-boundaries.md`
 * marks the `/api/v1/location/*` geocode endpoints as a V1.1 candidate — no
 * endpoints are added in this phase.
 *
 * The default behavior fails closed: with no provider configured, every
 * geocoding call throws a provider-independent `GeocodingProviderError`.
 * Results are returned as `LocationReference` (lat/lng + optional label) —
 * the map-ready contract — never as vendor payloads.
 */
import { ExternalServiceError } from '../../../lib/errors.js';
import type {
  Coordinate,
  LocationReference,
} from '../domain/location.types.js';

/**
 * The geocoding seam. A future implementation provides forward and reverse
 * geocoding WITHOUT coupling RidePool to its vendor. Implementations must
 * never leak vendor errors — they throw `GeocodingProviderError` instead.
 */
export interface GeocodingProvider {
  /** Machine-readable provider id, e.g. 'nominatim' | 'google-places'. */
  readonly id: string;
  /**
   * Forward geocoding: resolves a free-form human-readable place description
   * (e.g. "Indiranagar, Bengaluru") to candidate locations, most relevant
   * first. Resolves to an empty array when nothing matches; throws
   * `GeocodingProviderError` on failure.
   */
  forwardGeocode(query: string): Promise<LocationReference[]>;
  /**
   * Reverse geocoding: resolves a coordinate to a human-readable location, or
   * `null` when the coordinate cannot be described. Implementations must
   * reject invalid coordinates (see `domain/coordinate.ts`). Throws
   * `GeocodingProviderError` on failure.
   */
  reverseGeocode(coordinate: Coordinate): Promise<LocationReference | null>;
}

/**
 * Provider-independent geocoding failure (Phase 3.12 §20).
 *
 * Extends the existing `ExternalServiceError` (code EXTERNAL_SERVICE_ERROR,
 * HTTP 502, `expose: false`) — no new error framework. `providerId` records
 * which provider failed for diagnostics; the message stays vendor-neutral.
 */
export class GeocodingProviderError extends ExternalServiceError {
  readonly providerId: string;

  constructor(
    message: string,
    options: { providerId?: string; cause?: unknown } = {},
  ) {
    super(message, {
      details: { providerId: options.providerId ?? 'unconfigured' },
      cause: options.cause,
    });
    this.name = 'GeocodingProviderError';
    this.providerId = options.providerId ?? 'unconfigured';
  }
}

/**
 * The fail-closed default geocoding provider (OD-007 open). Every call throws
 * a provider-independent `GeocodingProviderError` — no network requests, no
 * vendor, no invented geocoding. A real implementation replaces this only
 * when a provider is actually selected.
 */
export const failClosedGeocodingProvider: GeocodingProvider = {
  id: 'fail-closed',
  async forwardGeocode() {
    throw new GeocodingProviderError(
      'No geocoding provider is configured (OD-007 is open); geocoding is unavailable',
    );
  },
  async reverseGeocode() {
    throw new GeocodingProviderError(
      'No geocoding provider is configured (OD-007 is open); reverse geocoding is unavailable',
    );
  },
};
