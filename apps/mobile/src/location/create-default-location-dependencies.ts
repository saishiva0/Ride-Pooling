/**
 * Default location & maps dependency wiring (Phase 3.20 — GOOGLE MAPS &
 * LOCATION INTEGRATION; OD-007 → Google Maps Platform).
 *
 * The composition root for the mobile location/maps boundary. When a Google
 * Maps API key is configured (`EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`), the real
 * Expo Location client and Google Geocoding/Routing providers are wired in.
 * Without a key everything FAILS CLOSED: device location is `unavailable`,
 * geocoding/routing throw normalized `MobileError`s, and map components render
 * an explanatory placeholder — the app never fabricates a coordinate, a place,
 * or a route.
 *
 * Consumers (screens/navigation) receive these defaults and can inject their
 * own implementations in tests via the same interface.
 */
import { loadMobileConfig } from '../config/env';
import { createExpoLocationClient } from './expo-location-client';
import {
  failClosedGeocodingProvider,
  type GeocodingProvider,
} from './geocoding';
import { createGoogleGeocodingProvider } from './google-geocoding-provider';
import { createGoogleRoutingProvider } from './google-routing-provider';
import {
  unavailableLocationClient,
  type LocationClient,
} from './location-client';
import { failClosedRoutingProvider, type RoutingProvider } from './routing';

export interface DefaultLocationDependencies {
  locationClient: LocationClient;
  geocodingProvider: GeocodingProvider;
  routingProvider: RoutingProvider;
}

/**
 * Builds the default location & maps dependencies from the mobile config.
 * Deterministic and safe to call any number of times.
 */
export function createDefaultLocationDependencies(
  env: Record<string, string | undefined> = process.env,
): DefaultLocationDependencies {
  const apiKey = loadMobileConfig(env).googleMapsApiKey;
  if (!apiKey) {
    return {
      locationClient: unavailableLocationClient,
      geocodingProvider: failClosedGeocodingProvider,
      routingProvider: failClosedRoutingProvider,
    };
  }
  return {
    locationClient: createExpoLocationClient(),
    geocodingProvider: createGoogleGeocodingProvider({ apiKey }),
    routingProvider: createGoogleRoutingProvider({ apiKey }),
  };
}
