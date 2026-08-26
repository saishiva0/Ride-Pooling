/**
 * Provider-independent geocoding seam (Phase 3.20 — GOOGLE MAPS & LOCATION
 * INTEGRATION; mirrors the Phase 3.12 backend port in
 * `apps/backend/src/modules/location/application/geocoding.ts`).
 *
 * The seam where a geocoding provider (OD-007 — Google, Mapbox, Nominatim,
 * etc.) plugs in, covering forward geocoding (place → coordinates) and reverse
 * geocoding (coordinates → readable location). Screens and hooks depend ONLY on
 * this interface — never on the Google Geocoding API directly.
 *
 * The default behavior fails closed: with no provider configured, every call
 * throws a normalized `MobileError` (`external-service`) — the app never
 * invents a place from a coordinate or fabricates coordinates from a query.
 */
import { MobileError } from '../api/errors';
import type { Coordinate, LocationReference } from './location.types';

/**
 * The geocoding seam. Implementations must never leak vendor errors — they
 * throw normalized `MobileError`s instead.
 */
export interface GeocodingProvider {
  /** Machine-readable provider id, e.g. 'google-maps' | 'mapbox'. */
  readonly id: string;
  /**
   * Forward geocoding: resolves a free-form human-readable place description
   * (e.g. "Indiranagar, Bengaluru") to candidate locations, most relevant
   * first. Resolves to an empty array when nothing matches; throws a
   * normalized `MobileError` on failure.
   */
  forwardGeocode(query: string): Promise<LocationReference[]>;
  /**
   * Reverse geocoding: resolves a coordinate to a human-readable location, or
   * `null` when the coordinate cannot be described. Throws a normalized
   * `MobileError` on failure.
   */
  reverseGeocode(coordinate: Coordinate): Promise<LocationReference | null>;
}

/**
 * The fail-closed default geocoding provider (OD-007 resolved with no key
 * configured). Every call throws — no network requests, no vendor, no invented
 * geocoding. A real implementation replaces this only when a provider is
 * actually configured.
 */
export const failClosedGeocodingProvider: GeocodingProvider = {
  id: 'fail-closed',
  async forwardGeocode() {
    throw new MobileError(
      'external-service',
      'Geocoding is unavailable (no Maps provider is configured)',
      { details: { provider: 'fail-closed', reason: 'unconfigured' } },
    );
  },
  async reverseGeocode() {
    throw new MobileError(
      'external-service',
      'Reverse geocoding is unavailable (no Maps provider is configured)',
      { details: { provider: 'fail-closed', reason: 'unconfigured' } },
    );
  },
};
