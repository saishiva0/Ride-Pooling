/**
 * Google Geocoding API adapter (Phase 3.20 — GOOGLE MAPS & LOCATION
 * INTEGRATION; OD-007 → Google Maps Platform).
 *
 * Implements the provider-neutral `GeocodingProvider` port on top of the
 * Google Geocoding API. Client-side (REST over `fetch`) per the phase decision:
 * the V1 mobile UX can safely perform geocoding client-side with an
 * Android/iOS-restricted public key, so no backend proxy endpoint or server
 * SDK is introduced. Screens and hooks depend only on the port — never on this
 * adapter or the Google API.
 *
 * Failure semantics: every non-OK response and transport failure is normalized
 * to a `MobileError` (`provider-errors.ts`) — Google status codes are never
 * exposed raw. `ZERO_RESULTS` resolves to an empty array (not an error).
 *
 * The `fetch` implementation is injectable so tests are deterministic; in the
 * app the global `fetch` is used.
 */
import { MobileError } from '../api/errors';
import type { GeocodingProvider } from './geocoding';
import type { Coordinate, LocationReference } from './location.types';
import {
  geocodeStatusKind,
  googleProviderError,
  GOOGLE_MAPS_PROVIDER_ID,
  type GoogleGeocodeStatus,
} from './provider-errors';

export const GOOGLE_GEOCODING_ENDPOINT =
  'https://maps.googleapis.com/maps/api/geocode/json';

interface GoogleGeocodeGeometry {
  location: { lat: number; lng: number };
}

interface GoogleGeocodeResult {
  formatted_address: string;
  geometry: GoogleGeocodeGeometry;
}

interface GoogleGeocodeResponse {
  status: GoogleGeocodeStatus;
  results: GoogleGeocodeResult[];
  error_message?: string;
}

function normalizeGeocodeError(
  status: GoogleGeocodeStatus,
  errorMessage: string | undefined,
): MobileError {
  const kind = geocodeStatusKind(status);
  return googleProviderError(
    kind,
    status === 'OVER_QUERY_LIMIT'
      ? 'Geocoding is temporarily rate-limited'
      : 'Geocoding is unavailable',
    { status, cause: errorMessage },
  );
}

function resultToLocationReference(
  result: GoogleGeocodeResult,
): LocationReference {
  return {
    latitude: result.geometry.location.lat,
    longitude: result.geometry.location.lng,
    label: result.formatted_address,
  };
}

export interface GoogleGeocodingProviderOptions {
  apiKey: string;
  /** Injectable fetch (tests). Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Creates a `GeocodingProvider` backed by the Google Geocoding API. */
export function createGoogleGeocodingProvider(
  options: GoogleGeocodingProviderOptions,
): GeocodingProvider {
  const apiKey = options.apiKey;
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request(
    params: URLSearchParams,
  ): Promise<GoogleGeocodeResponse> {
    const url = `${GOOGLE_GEOCODING_ENDPOINT}?${params.toString()}`;
    let response: Response;
    try {
      response = await fetchImpl(url);
    } catch (err) {
      throw googleProviderError('network', 'Geocoding network request failed', {
        cause: err,
      });
    }
    if (!response.ok) {
      throw googleProviderError(
        'external-service',
        'Geocoding service returned an error response',
        { status: String(response.status), cause: response.status },
      );
    }
    let body: GoogleGeocodeResponse;
    try {
      body = (await response.json()) as GoogleGeocodeResponse;
    } catch (err) {
      throw googleProviderError(
        'external-service',
        'Geocoding service returned an unreadable response',
        { cause: err },
      );
    }
    if (body.status === 'ZERO_RESULTS') {
      // A valid "no match" answer — an empty result, not an error.
      return { status: 'ZERO_RESULTS', results: [] };
    }
    if (body.status !== 'OK') {
      throw normalizeGeocodeError(body.status, body.error_message);
    }
    return body;
  }

  return {
    id: GOOGLE_MAPS_PROVIDER_ID,
    async forwardGeocode(query: string): Promise<LocationReference[]> {
      const trimmed = query.trim();
      if (!trimmed) {
        throw new MobileError('validation', 'A place is required', {
          details: { provider: GOOGLE_MAPS_PROVIDER_ID, reason: 'empty-query' },
        });
      }
      const params = new URLSearchParams();
      params.set('address', trimmed);
      params.set('key', apiKey);
      const body = await request(params);
      return body.results.map(resultToLocationReference);
    },
    async reverseGeocode(
      coordinate: Coordinate,
    ): Promise<LocationReference | null> {
      const params = new URLSearchParams();
      params.set('latlng', `${coordinate.latitude},${coordinate.longitude}`);
      params.set('key', apiKey);
      const body = await request(params);
      if (body.results.length === 0) {
        return null;
      }
      return resultToLocationReference(body.results[0]);
    },
  };
}
