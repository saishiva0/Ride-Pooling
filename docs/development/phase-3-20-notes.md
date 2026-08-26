# Phase 3.20 Notes — Google Maps & Location Integration

**Status:** COMPLETE
**Date:** 2026-08-20
**Resolves:** OD-007 (Map provider / geocoding / distance provider)

---

## Summary

Phase 3.20 resolves OD-007 by integrating Google Maps Platform behind the
existing provider-neutral location boundary. The mobile app now renders
real maps, resolves addresses/coordinates (geocoding), and computes display
route distance/duration (routing) entirely client-side against Google REST
APIs with a public, Android/iOS-restricted key. No backend change, no schema
change, no matching/auth change. With no Maps key configured, everything fails
closed — the map shows an explanatory placeholder and the route preview is
hidden; the app never fabricates coordinates, places, or routes.

**OD-007 Resolution (approved):**

- Provider: **Google Maps Platform** (maps, geocoding, Routes API)
- Geocoding/routing run **client-side** from the mobile app via public REST
  endpoints with a public restricted key (`EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`)
- Consumed only through provider-neutral ports (`GeocodingProvider`,
  `RoutingProvider`, existing `LocationClient`) — UI code never calls Google
  directly
- Missing key → `unavailableLocationClient` + `failClosedGeocodingProvider` +
  `failClosedRoutingProvider` (fail closed)
- Discovery distance remains backend-computed (Phase 3.3 PostGIS); client
  routing is display-only and never affects matching/discovery

---

## Changes by Layer

### Canonical Documentation

- `docs/planning/open-decisions.md`: OD-007 marked RESOLVED with full decision record
- `apps/mobile/README.md`: Phase badge, OD-007 status, boundaries/config/testing updates
- `docs/development/phase-3-20-notes.md`: This document

### Mobile (`apps/mobile`)

**Dependencies:**

- `package.json`: Added `expo-location@~57.0.11` and `react-native-maps@1.27.2`

**Configuration:**

- `src/config/env.ts`: Added `googleMapsApiKey` to `MobileConfig`;
  `resolveGoogleMapsApiKey` reads `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`
- `.env.example`: Documented `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`
- `src/config/env.test.ts`: Tests for Maps key parsing
- `app.json`: Added `react-native-maps` config plugin (android/ios keys from
  `process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`) and `expo-location` plugin
  with `locationWhenInUsePermission`

**Location ports & types:**

- `src/location/location.types.ts`: Added `RouteRequest`, `LineStringGeometry`,
  `RouteResult`
- `src/location/geocoding.ts`: `GeocodingProvider` port +
  `failClosedGeocodingProvider`
- `src/location/routing.ts`: `RoutingProvider` port +
  `failClosedRoutingProvider`
- `src/location/provider-errors.ts`: `GOOGLE_MAPS_PROVIDER_ID`, `googleProviderError`
  normalization to `MobileError` kinds (network/timeout/validation/not-found/
  rate-limited/external-service)

**Providers & adapters:**

- `src/location/expo-location-client.ts`: `createExpoLocationClient` (injectable
  native module) — native `expo-location` adapter behind `LocationClient`
- `src/location/google-geocoding-provider.ts`: `createGoogleGeocodingProvider`
  (Google Geocoding REST; `ZERO_RESULTS` → empty result, not an error)
- `src/location/google-routing-provider.ts`: `createGoogleRoutingProvider`
  (Google Routes API, `ENCODED_POLYLINE`, field mask, duration parsing)
- `src/location/polyline.ts`: `decodePolyline` → `[lng, lat]` coordinates
- `src/location/create-default-location-dependencies.ts`:
  `createDefaultLocationDependencies` wires real providers when a key exists,
  fail-closed defaults otherwise

**Components:**

- `src/components/ride-pool-map.tsx`: `RidePoolMap` (markers + optional route
  polyline; explanatory placeholder when unavailable)
- `src/components/location-search.tsx`: `LocationSearch` (forward geocoding)
- `src/components/location-picker.tsx`: `LocationPicker` (pickup/destination
  pickers with search + reverse-geocode on map tap)
- `src/components/route-preview.tsx`: `RoutePreview` (distance/duration)

**Hooks:**

- `src/hooks/use-geocoding.ts`: forward/reverse geocoding through `AsyncState`
- `src/hooks/use-route.ts`: `useRoute` (dedupe in-flight, latest-wins, errors
  normalized to `MobileError`)
- `src/hooks/use-map-location.ts`: `useMapLocation` — map-ready current
  location + geocoding of the current coordinate

**Screens:**

- `src/screens/rides/rides-home-screen.tsx`: Discovery map with
  pickup/destination markers; tapping the map reverse-geocodes and fills the
  pickup field
- `src/screens/rides/create-ride-screen.tsx`: `LocationPicker`s for pickup and
  destination
- `src/screens/rides/ride-details-screen.tsx`: Ride map + route preview
  (distance/duration) via `RoutingProvider`

**Navigation:**

- `src/navigation/app-navigator.tsx`: Wires `createDefaultLocationDependencies`
  and passes `geocodingProvider` / `routingProvider` / `locationClient` to
  screens

**Test infra:**

- `tests/mocks/react-native-maps.ts`: `react-native-maps` mock (host `View`
  elements with forwarded props)
- `tests/mocks/expo-location.ts`: `expo-location` mock (fail-closed throws)
- `vitest.config.ts`: Aliases for `react-native-maps` and `expo-location`
- `tests/fixtures.ts`: Added `fakeGeocodingProvider`, `fakeRoutingProvider`

**Tests (new):**

- `src/location/polyline.test.ts`, `google-geocoding-provider.test.ts`,
  `google-routing-provider.test.ts`, `expo-location-client.test.ts`,
  `create-default-location-dependencies.test.ts`
- `src/components/ride-pool-map.test.tsx`, `location-search.test.tsx`,
  `location-picker.test.tsx`, `route-preview.test.tsx`
- `src/hooks/use-geocoding.test.tsx`, `use-route.test.tsx`
- `src/config/env.test.ts`

---

## Test Results

**Backend:** unchanged — unit suites pass (663 tests). Real-database
integration suites (194 tests) require PostgreSQL on `localhost:5433`, which is
not running in this environment; they are unrelated to this phase (no backend
files changed).

**Mobile:** 47 test files, **336 tests passed** (baseline 336; new Phase 3.20
tests cover polyline, providers, components, hooks, and config — no existing
test was removed)

---

## Quality Gates

- ✅ Mobile: `lint`, `typecheck`, `test` (336/336)
- ✅ Backend: `lint`, `typecheck`, `build` (unchanged; integration tests need a running database)
- ⚠️ Format: `pnpm format:check` — clean for all changed/new files; two
  historical docs (`phase-3-19-notes.md`, `phase-3-19-verification-report.md`)
  have pre-existing formatting drift and are left untouched (historical)
- ✅ Expo config: `expo config --type public` — clean, resolves
  `react-native-maps` and `expo-location` plugins (SDK 57)

---

## Notes

- **Client-side Google usage is intentional and documented:** the Maps key is a
  public, Android/iOS-restricted key inlined into the bundle by design; the
  backend never touches it and no server-side secrets are added. This satisfies
  spec §29 (client may resolve addresses/coordinates without server
  involvement).
- **Fail-closed default verified:** with no `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`,
  map features render an explanatory placeholder, geocoding/routing reject with
  normalized `MobileError`s, and no fabricated data is ever produced.
- **`react-native-maps` on iOS requires a development build** (custom dev
  client / prebuild) because of the config plugin; it does not render in Expo
  Go. Android renders in Expo Go. `expo-location` works in Expo Go.
- **Route preview is display-only:** client routing never influences
  discovery/matching results (those remain backend PostGIS computations).
- **Test-infra note:** `react-native-maps` and `expo-location` are aliased to
  mocks only under vitest; the mocks render plain host elements so tests can
  assert on forwarded props and marker counts.
- **Pre-existing time-bomb fixed:** `src/ride/validation.test.ts` fixtures
  referenced a hard-coded departure datetime (`2026-08-20T10:00:00.000Z`) that
  became "in the past" during this phase; moved to `2099-01-01T10:00:00.000Z`
  (2 occurrences) so the past-departure rejection tests stay deterministic.
- **No backend changes, no schema changes, no migrations, no new entities.**
- **OD-004, OD-005 remain RESOLVED** (Phases 3.19, 3.18). OD-008 (realtime)
  and OD-010 (verification) remain OPEN.

---

## Verification Checklist

- [x] OD-007 resolved in canonical docs (`open-decisions.md`, README)
- [x] Google Geocoding + Routes providers behind provider-neutral ports, with
      mocked-fetch tests pinning exact URLs/headers/bodies and error mapping
- [x] Fail-closed behavior without a Maps key (placeholder, no fabricated data)
- [x] Map view + markers on discovery/details; map-tap reverse geocode on discovery
- [x] Address search + pickers on create-ride
- [x] Route preview (distance/duration) on ride details
- [x] All mobile quality gates pass (lint, typecheck, test)
- [x] Backend untouched and green (lint/typecheck/build)
- [x] No schema changes, no migrations, no new entities
- [x] LIVE GOOGLE VERIFICATION: **NOT RUN** (no Maps API key available in this
      environment; wire keys + run on a device/emulator to verify live behavior)
