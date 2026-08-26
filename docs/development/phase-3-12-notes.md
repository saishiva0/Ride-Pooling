# Phase 3.12 — Location & Maps Foundation: Implementation Notes

> Status: Phase 3.12 — Implementation
> Records how the provider-independent Location & Maps foundation was built on
> top of the existing Phase 2 location persistence, Phase 3.1 coordinate
> validation, Phase 3.3 PostGIS discovery, Phase 3.4 matching distance, and
> the Phase 3.10/3.11 HTTP/realtime boundaries. Phase 0/1 documents remain the
> source of truth; this note does not change product/domain decisions or
> resolve any open decision (OD-001…OD-019). **OD-007 (map/routing/geocoding
> provider) remains OPEN** — no provider was selected, no SDK, no API keys, no
> provider-specific environment variables, and no network calls were
> introduced.

## 1. Objective

Build the provider-independent Location & Maps foundation required by future
mobile and Ride Engine flows — WITHOUT integrating a real map provider and
WITHOUT changing any existing behavior. The foundation covers: coordinates,
locations, coordinate validation, geographic distance, location privacy,
routing/geocoding provider seams, map-ready API contracts, and future mobile
integration. The system is fully usable today with no external map provider
(the straight-line great-circle distance and PostGIS discovery remain
authoritative).

## 2. Existing location architecture (reused, not rebuilt)

Before writing code, the following existing pieces were inspected and treated
as authoritative:

| Existing piece                                                                              | Where                                                                                | Role in this phase                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Location` model (lat/lng `Decimal(9,6)` + generated PostGIS `geometry(Point, 4326)` point) | `prisma/schema.prisma`, Phase 2 migration                                            | **Authoritative persistence.** Untouched. No schema change.                                                                                                           |
| `RideCoordinates { latitude, longitude }`                                                   | `modules/ride/domain/ride.types.ts` (Phase 3.1)                                      | Structurally identical to the new `Coordinate`; remains authoritative inside the Ride Engine.                                                                         |
| `isValidLatitude` / `isValidLongitude` (WGS84 bounds)                                       | `modules/ride/domain/ride-rules.ts` (Phase 3.1)                                      | **Centralized** into `modules/location/domain/coordinate.ts`; ride-rules re-exports them (public API unchanged, single implementation).                               |
| `greatCircleDistanceMeters` (haversine, meters)                                             | `modules/ride/domain/matching/distance.ts` (Phase 3.4)                               | **Reused** as the default distance provider — no second Haversine was written.                                                                                        |
| PostGIS discovery (`ST_DWithin` / `ST_Distance`, `ST_MakePoint(longitude, latitude)`)       | `modules/ride/infrastructure/ride.repository.ts` (Phase 3.3)                         | **Untouched.** Discovery stays database-side with geographic semantics, meter units, nearest-first ordering, eligible statuses, and seat filtering exactly as before. |
| Coordinate-order regression                                                                 | `discovery.integration.test.ts` (Phase 3.3)                                          | Preserved (pins `longitude,latitude` at the PostGIS boundary). The new pure serializer gets its own regression at the new boundary (§6).                              |
| Ride creation (location persistence, DRAFT, status history, single transaction)             | `modules/ride/application/create-ride.ts`, `ride.repository.ts` (Phase 3.2)          | **Untouched.** No auto-geocoding, no route distance computation, no provider calls added.                                                                             |
| Matching (five deterministic factors, no score/weights/AI)                                  | `modules/ride/domain/matching/` (Phase 3.4)                                          | **Untouched.** Great-circle fallback remains valid. OD-004 stays open.                                                                                                |
| AppError hierarchy (incl. `ExternalServiceError` 502)                                       | `src/lib/errors.ts` (Phase 1)                                                        | Provider errors are built on `ExternalServiceError` — no second error framework.                                                                                      |
| Port + fail-closed-default precedent                                                        | `auth/application/authenticator.ts`, `auth/http/auth.middleware.ts` (Phase 3.9/3.10) | The routing/geocoding seams mirror this pattern (`failClosedRoutingProvider` / `failClosedGeocodingProvider`).                                                        |

## 3. New abstractions (module `modules/location/`)

```
modules/location/
  README.md
  domain/
    location.types.ts    — Coordinate, LocationReference, RouteRequest,
                           RouteResult, LineStringGeometry, GeoJsonPoint
    coordinate.ts        — WGS84 bounds + predicates, isValidCoordinate,
                           assertValidCoordinate, asCoordinate, toGeoJsonPoint
    coordinate.test.ts
  application/
    distance.ts          — DistanceProvider port + greatCircleDistanceProvider
                           (reuses Phase 3.4) + calculateDistanceMeters
    distance.test.ts
    routing.ts           — RoutingProvider port + RoutingProviderError +
                           failClosedRoutingProvider
    routing.test.ts
    geocoding.ts         — GeocodingProvider port + GeocodingProviderError +
                           failClosedGeocodingProvider
    geocoding.test.ts
```

- **`Coordinate`** — the canonical conceptual shape (latitude/longitude),
  structurally identical to (and mutually assignable with) the Phase 3.1
  `RideCoordinates`. No conversion needed.
- **`LocationReference`** — the map-ready, client-facing contract: latitude,
  longitude, optional `label`. No database ids, no PostGIS details, no
  address/place ids (not persisted by the approved schema). Existing ride API
  responses (`pickupLocation` / `destinationLocation` = `{ id, latitude,
longitude, label }`) are a superset of this contract and already map-ready.
- **`coordinate.ts`** — centralized WGS84 validation. `ride-rules.ts`
  re-exports `isValidLatitude`/`isValidLongitude` from here, so the Ride
  Engine's public surface is unchanged while validation lives in exactly one
  framework-free place (success criteria: "coordinate validation remains
  centralized"; phase requirement: the coordinate abstraction depends on no
  Prisma/Express/React Native/Socket.io/provider).
- **`distance.ts`** — `DistanceProvider` port (`distanceMeters(a, b)`, unit in
  the name) with `greatCircleDistanceProvider` as the default, delegating to
  the Phase 3.4 haversine. `calculateDistanceMeters(a, b, provider?)` is the
  injectable facade.
- **`routing.ts`** — `RoutingProvider.calculateRoute(RouteRequest) →
Promise<RouteResult>` (distanceMeters / durationSeconds / optional
  geometry). `RoutingProviderError extends ExternalServiceError` (502,
  `expose: false`). `failClosedRoutingProvider` is the default: every call
  throws a provider-independent error naming OD-007 — no network, no invented
  route.
- **`geocoding.ts`** — `GeocodingProvider.forwardGeocode(query) →
LocationReference[]` and `reverseGeocode(coordinate) → LocationReference |
null`. `GeocodingProviderError extends ExternalServiceError`.
  `failClosedGeocodingProvider` is the default.
- **`toGeoJsonPoint`** — pure RFC 7946 GeoJSON Point serializer with
  **[longitude, latitude]** order (PostGIS convention), for future map
  clients. GeoJSON is **never persisted**.

## 4. Provider boundary

OD-007 must remain open. This phase created **seams only**:

- No provider is selected (Google Maps, Google Places, Mapbox, Mappls, HERE,
  OSM-based providers, etc. are all out).
- No provider SDKs, no API keys, no provider-specific environment variables
  (`GOOGLE_MAPS_API_KEY`, `MAPBOX_TOKEN`, `MAPPLS_KEY`, `HERE_API_KEY`, …).
- No network calls anywhere in the module — the phase runs fully offline.
- Default behavior is provider-independent and **fails closed**: with no
  provider configured, routing/geocoding calls throw provider-independent
  errors; distance defaults to the pure great-circle computation.
- Failure semantics (§20): provider failures are represented by
  `RoutingProviderError` / `GeocodingProviderError`, built on the existing
  `ExternalServiceError` (code `EXTERNAL_SERVICE_ERROR`, HTTP 502,
  `expose: false`). Vendor-specific errors never leak into the domain or API
  responses; the error handler maps them to generic responses.

Architectural direction maintained: Domain → Application → Provider
interfaces → Infrastructure implementations. The domain layer imports no
Prisma, Express, Socket.io, or provider SDK.

## 5. Distance semantics

- The system's distance semantics are **straight-line great-circle distance
  (WGS84) in meters** for pickup proximity, destination compatibility, and
  discovery distance — unchanged (`docs/domain/matching-model.md` §7; Phase
  3.3/3.4 behavior preserved exactly).
- The Phase 3.4 `greatCircleDistanceMeters` remains the authoritative
  implementation; the new `DistanceProvider` default delegates to it (verified
  by test: identical values, no second algorithm).
- Units: **meters** for spatial distance (canonical). Every public result
  makes its unit explicit by name (`distanceMeters`, `distanceKm` is reserved
  for product pricing display; no ambiguous bare `distance` is introduced).
- No unit mixing inside any function.

## 6. Coordinate semantics & ordering

- WGS84 decimal degrees: latitude ∈ [-90, 90], longitude ∈ [-180, 180],
  finite numbers only (NaN / ±Infinity rejected) — unchanged from Phase 3.1.
- Valid coordinates are passed through **unchanged**: the normalization layer
  (`asCoordinate`) validates and rejects, but never rounds, truncates, or
  invents a precision policy.
- Coordinate order: PostGIS and GeoJSON both use **longitude first, latitude
  second**. The Phase 3.3 discovery integration test already pins this at the
  PostGIS boundary; `toGeoJsonPoint`'s own regression test pins it at the new
  serialization boundary (`[longitude, latitude]`, e.g. longitude=77.5946,
  latitude=12.9716 → `[77.5946, 12.9716]`, never `[12.9716, 77.5946]`).

## 7. Privacy boundary

No new privacy-sensitive data flows were introduced:

- Only ride **pickup/destination** coordinates flow through the system
  (already user-consented published ride data, `docs/domain/domain-model.md`
  §5.3).
- No participant live location, no continuous tracking, no background GPS, no
  location history, no driver/participant tracking — explicitly out of scope.
- `LocationReference` exposes only what a map client needs (lat/lng + label).
- No precise location data is logged by this module; no logging was added.

## 8. API impact

- **No new endpoints.** No `/maps/*`, no `/api/v1/location/*` (the Phase 0
  API boundary marks reverse-geocode/distance proxy as a **V1.1 candidate**).
- Existing ride responses already expose map-ready locations: `CreatedRide` /
  `DiscoveredRide` return `pickupLocation` / `destinationLocation` as
  `{ id, latitude, longitude, label }`, a superset of `LocationReference`.
  This was verified against the existing HTTP integration tests (which assert
  the location shape in create/discover responses); no response shape changed.
- Success/error envelopes (`{ data }` / `{ error }`) unchanged — no new
  envelope.

## 9. Database impact

- **No schema change, no migration, no seed change.** The Phase 2 `Location`
  model (lat/lng + generated PostGIS point) remains authoritative and was not
  duplicated or modified. Verified via `prisma validate`, `prisma migrate
status` (no pending migrations), and the database check.
- PostGIS regression: existing discovery/matching integration tests continue
  to pass against the real database (SRID 4326, `ST_AsText` correct,
  discovery/matching working).

## 10. Tests

54 new unit tests (all offline, deterministic, no database/network):

- **`domain/coordinate.test.ts` (30)** — valid/invalid/boundary latitude
  (±90), valid/invalid/boundary longitude (±180), NaN/±Infinity for both
  axes, `isValidCoordinate` pair semantics, `assertValidCoordinate` field
  paths + error shape, `asCoordinate` (values unchanged, no precision
  alteration, rejects NaN/Infinity/out-of-range), `toGeoJsonPoint` (type,
  **longitude-first ordering regression**, determinism, boundaries, rejects
  invalid input).
- **`application/distance.test.ts` (10)** — default provider delegates to the
  authoritative Phase 3.4 function (identical values), zero distance for the
  same point, symmetry, determinism, meter units (1° lat ≈ 111.19 km, known
  Bengaluru→Mysuru pair), injectable fake provider honored.
- **`application/routing.test.ts` (6)** — fake provider success (explicit
  units + optional geometry), fake provider failure as `RoutingProviderError`,
  fail-closed default throws provider-independent error (no network), error
  semantics (code/status/expose/providerId), no vendor dependency.
- **`application/geocoding.test.ts` (8)** — fake forward/reverse success
  (returns `LocationReference[]` / `LocationReference | null`), fake failure,
  fail-closed default for both directions, error semantics, no vendor
  dependency.

Existing ride-domain tests (`ride-rules.test.ts` 36, matching domain 48)
continue to pass unchanged after the coordinate-predicate centralization
(behavior-identical re-export).

## 11. Open decisions (traceability)

- **OD-007 — OPEN.** The system has provider-neutral seams (routing,
  geocoding, distance ports) but **no production provider**. Provider
  selection remains a product/technical decision. No SDK, key, or env var was
  introduced.
- **OD-004 — OPEN.** No matching thresholds/weights/scoring introduced; the
  matching implementation is untouched.
- **OD-005 — OPEN.** No authentication mechanism introduced; the existing
  fail-closed HTTP/socket posture is unchanged.
- All other open decisions (OD-001…OD-003, OD-006, OD-008…OD-019) untouched.

## 12. Limitations

- Routing and geocoding are **unavailable** until a provider is selected
  (fail-closed by design).
- Distance remains straight-line great-circle; route-based distance/duration
  requires OD-007.
- No coordinate precision/rounding policy exists (none invented); the
  database stores 9,6 decimals as Phase 2 defined.
- No location API endpoints exist (V1.1 candidate per Phase 0).
- `LocationReference` carries only lat/lng + label — address/place identifiers
  are future metadata and are not persisted anywhere.

## 13. Future provider integration

When OD-007 is decided, a provider is added at the infrastructure boundary
only:

1. Implement `RoutingProvider` (e.g. OSRM/Google/Mapbox/Here adapter) and/or
   `GeocodingProvider`; wrap every vendor error in
   `RoutingProviderError` / `GeocodingProviderError`.
2. Wire the implementation where the feature needs it (a future location
   application service or route/geocode endpoint); the ports are the only
   seam the rest of the system sees.
3. A routing-based distance can replace `greatCircleDistanceProvider` for
   specific features behind the `DistanceProvider` port without touching
   callers; the pure great-circle remains the deterministic default.
4. Provider credentials, when they exist, are injected via environment at the
   infrastructure layer — never in the domain or shared contracts.

## 14. Phase 3.12 completion status

**COMPLETE.**

- Existing location model authoritative — ✅ (no schema change).
- Coordinate validation centralized — ✅ (single implementation in
  `modules/location/domain/coordinate.ts`, re-exported by ride rules).
- Distance implementation not duplicated — ✅ (default delegates to Phase 3.4).
- Discovery remains PostGIS-based — ✅ (untouched; integration tests pass).
- Matching remains deterministic — ✅ (untouched).
- No provider selected — ✅ (OD-007 open).
- No external map API called / no provider credentials — ✅ (offline, fail
  closed).
- Location privacy preserved — ✅ (no new data flows).
- Mobile UI untouched — ✅.
- Existing APIs keep working — ✅ (no route changes; HTTP integration tests
  pass).
- Existing tests remain green — ✅ (full backend suite green).
- New tests cover all new behavior — ✅ (54 new tests).
- Documentation updated — ✅ (`phase-3-12-notes.md`, module READMEs).
- No unrelated phase work introduced — ✅.

**Phase 3.13 (Mobile Foundation) was NOT started.** No mobile map UI, no
Expo location integration, no GPS hooks, no permissions, no map SDK.
