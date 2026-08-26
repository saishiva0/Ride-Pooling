# Location & Maps Module

Provider-independent Location & Maps foundation (Phase 3.12).

**OD-007 (map / routing / geocoding provider) is OPEN** — the project has NOT
selected Google Maps, Mapbox, Mappls, HERE, OpenStreetMap, or any other
provider (`docs/planning/open-decisions.md`). This module therefore provides
only **provider-independent foundations**: coordinate types & validation, a
distance abstraction over the existing great-circle implementation, and the
routing/geocoding seams where a future provider plugs in. No provider SDK, no
API keys, no provider-specific environment variables, and no network calls
exist here. The system is fully usable today without any external map
provider.

## Layout

```
modules/location/
  domain/        location.types.ts  — Coordinate, LocationReference, RouteResult,
                                      GeoJSON types (pure, framework-free)
                 coordinate.ts      — centralized WGS84 bounds + predicates,
                                      normalization, GeoJSON serialization
  application/   distance.ts        — DistanceProvider port + great-circle default
                                      (reuses the Phase 3.4 implementation)
                 routing.ts         — RoutingProvider port + RoutingProviderError
                                      + fail-closed default
                 geocoding.ts       — GeocodingProvider port + GeocodingProviderError
                                      + fail-closed default
```

## What this phase provides

1. **Coordinate domain** (`domain/coordinate.ts`) — the single home of the
   WGS84 bounds and predicates (`isValidLatitude` / `isValidLongitude`,
   `isValidCoordinate`, `assertValidCoordinate`, `asCoordinate`). The Phase 3.1
   ride rules re-export the predicates from here, so validation is centralized
   in one framework-free place and the Ride Engine's public surface is
   unchanged. Pure — no Prisma, Express, React Native, Socket.io, or provider.
2. **Location types** (`domain/location.types.ts`) — `Coordinate` (the
   canonical lat/lng pair, structurally identical to the Phase 3.1
   `RideCoordinates`), `LocationReference` (the map-ready client contract:
   lat/lng + optional label), and the routing/GeoJSON shapes. No address/place
   ids — the approved schema persists only lat/lng + label.
3. **Distance service** (`application/distance.ts`) — the `DistanceProvider`
   port with a default that **reuses** the authoritative Phase 3.4
   great-circle implementation (`greatCircleDistanceMeters`) — no second
   Haversine. Units are meters, explicit by name. Deterministic and offline.
4. **Routing seam** (`application/routing.ts`) — the `RoutingProvider` port
   (`calculateRoute` → `RouteResult` with `distanceMeters` / `durationSeconds`
   / optional geometry). **No provider is implemented.** The default
   (`failClosedRoutingProvider`) throws a provider-independent
   `RoutingProviderError` (502, built on `ExternalServiceError`) — the system
   never silently calls a vendor or invents a route.
5. **Geocoding seam** (`application/geocoding.ts`) — the `GeocodingProvider`
   port (forward: place → `LocationReference[]`; reverse: coordinate →
   `LocationReference | null`). **No provider is implemented.** The default
   (`failClosedGeocodingProvider`) throws `GeocodingProviderError`.
   `/api/v1/location/*` endpoints are a V1.1 candidate per
   `docs/architecture/api-boundaries.md` — none were added in this phase.
6. **Privacy boundary** — the module exposes only pickup/destination
   coordinates (already user-consented published ride data). No participant
   live location, no continuous tracking, no background GPS, no location
   history — those are outside this phase.

## What this phase does NOT do

- No provider integration (OD-007 open), no API keys, no env vars.
- No HTTP endpoints (no `/maps/*`, no `/api/v1/location/*`).
- No schema change: the Phase 2 `Location` model (lat/lng Decimal + generated
  PostGIS point) remains authoritative and untouched.
- No GeoJSON persistence — only a pure serializer (`toGeoJsonPoint`, longitude
  first) for future map clients.
- No mobile map UI, permissions, or GPS (later phases).
- Discovery/matching behavior unchanged: PostGIS `ST_DWithin`/`ST_Distance`
  remain authoritative; the great-circle fallback remains the V1 distance
  semantics.
