/**
 * Google Routes API adapter (Phase 3.20 — GOOGLE MAPS & LOCATION INTEGRATION;
 * OD-007 → Google Maps Platform).
 *
 * Implements the provider-neutral `RoutingProvider` port on top of the Google
 * Routes API (`computeRoutes`). Client-side (REST over `fetch`) per the phase
 * decision — no backend proxy or server SDK is introduced. Screens and hooks
 * depend only on the port.
 *
 * Response geometry (an encoded polyline) is decoded into the project's
 * `LineStringGeometry` convention ([longitude, latitude]). Duration arrives as
 * an ISO-8601-ish duration string ("1234.5s") and is normalized to whole
 * seconds. Every non-OK response and transport failure is normalized to a
 * `MobileError` (`provider-errors.ts`).
 *
 * The `fetch` implementation is injectable so tests are deterministic.
 */
import { MobileError } from '../api/errors';
import type { RouteRequest, RouteResult } from './location.types';
import { decodePolyline } from './polyline';
import type { RoutingProvider } from './routing';
import {
  googleProviderError,
  GOOGLE_MAPS_PROVIDER_ID,
  routesErrorKind,
} from './provider-errors';

export const GOOGLE_ROUTES_ENDPOINT =
  'https://routes.googleapis.com/directions/v2:computeRoutes';

/** Field mask keeping the response lean (distance, duration, geometry). */
export const GOOGLE_ROUTES_FIELD_MASK =
  'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline';

interface GoogleRoutesResponse {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    polyline?: { encodedPolyline?: string };
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

/**
 * Parses the Routes API duration string ("1234.5s" / "65s") into whole
 * seconds. Returns 0 when the format is unexpected so the caller still has a
 * usable route (the geometry and distance remain authoritative).
 */
export function parseGoogleDurationSeconds(
  duration: string | undefined,
): number {
  if (!duration) {
    return 0;
  }
  const match = /^(\d+(?:\.\d+)?)s$/.exec(duration.trim());
  if (!match) {
    return 0;
  }
  return Math.round(Number.parseFloat(match[1]));
}

export interface GoogleRoutingProviderOptions {
  apiKey: string;
  /** Injectable fetch (tests). Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Creates a `RoutingProvider` backed by the Google Routes API. */
export function createGoogleRoutingProvider(
  options: GoogleRoutingProviderOptions,
): RoutingProvider {
  const apiKey = options.apiKey;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    id: GOOGLE_MAPS_PROVIDER_ID,
    async calculateRoute(request: RouteRequest): Promise<RouteResult> {
      const body = {
        origin: {
          location: {
            latLng: {
              latitude: request.origin.latitude,
              longitude: request.origin.longitude,
            },
          },
        },
        destination: {
          location: {
            latLng: {
              latitude: request.destination.latitude,
              longitude: request.destination.longitude,
            },
          },
        },
        travelMode: 'DRIVE',
      };

      let response: Response;
      try {
        response = await fetchImpl(GOOGLE_ROUTES_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': GOOGLE_ROUTES_FIELD_MASK,
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        throw googleProviderError('network', 'Route network request failed', {
          cause: err,
        });
      }

      if (!response.ok) {
        throw googleProviderError(
          'external-service',
          'Route service returned an error response',
          { status: String(response.status), cause: response.status },
        );
      }

      let payload: GoogleRoutesResponse;
      try {
        payload = (await response.json()) as GoogleRoutesResponse;
      } catch (err) {
        throw googleProviderError(
          'external-service',
          'Route service returned an unreadable response',
          { cause: err },
        );
      }

      if (payload.error) {
        const kind = routesErrorKind(payload.error.status ?? '');
        throw googleProviderError(
          kind,
          kind === 'rate-limited'
            ? 'Route calculation is temporarily rate-limited'
            : 'Route calculation is unavailable',
          {
            code: payload.error.status ?? 'UNKNOWN',
            cause: payload.error.message,
          },
        );
      }

      const route = payload.routes?.[0];
      if (!route) {
        throw new MobileError('not-found', 'No route could be calculated', {
          details: { provider: GOOGLE_MAPS_PROVIDER_ID, reason: 'no-route' },
        });
      }

      const distanceMeters = route.distanceMeters ?? 0;
      const encoded = route.polyline?.encodedPolyline;
      const coordinates = encoded ? decodePolyline(encoded) : [];
      const geometry =
        coordinates.length >= 2
          ? { type: 'LineString' as const, coordinates }
          : undefined;

      return {
        distanceMeters,
        durationSeconds: parseGoogleDurationSeconds(route.duration),
        ...(geometry ? { geometry } : {}),
      };
    },
  };
}
