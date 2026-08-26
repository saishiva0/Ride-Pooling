# Phase 3.3 — Ride Discovery: Implementation Notes

> Status: Phase 3.3 — Implementation
> Records how Ride Discovery was built on top of Phase 3.2 (Ride creation),
> including the discovery-vs-matching boundary, the PostGIS query approach,
> eligibility rules, and implementation-level decisions. Phase 0/1 documents
> remain the source of truth; this note does not change product/domain
> decisions or resolve any open decision (OD-001…OD-019).

## 1. Purpose and boundary

Discovery answers: **"Which published rides are geographically near this
participant's requested pickup point and otherwise eligible to be
discovered?"** It is a candidate-retrieval mechanism and deliberately does
**not** answer "which ride is the best match?" — no scoring, no ranking, no
destination/time/seat compatibility evaluation. Matching (Phase 3.4) will
operate on the candidates returned here.

## 2. Traceability

| Phase 0 requirement                                                                                   | Implementation                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `docs/domain/matching-model.md` §2/§3/§4 — candidates are `PUBLISHED`/`CONFIRMED` with seats          | `DISCOVERABLE_RIDE_STATUSES = [PUBLISHED, CONFIRMED]` + seat filter (`availableSeats > 0`) in the query |
| `docs/domain/ride-lifecycle.md` §2.2/§2.3 — PUBLISHED discoverable; CONFIRMED open while seats remain | Status set above; `DRAFT` and terminal states never returned                                            |
| `docs/domain/matching-model.md` §7 — participant lat/lng + search radius                              | `RideDiscoveryInput { latitude, longitude, radiusMeters, limit? }`                                      |
| `docs/domain/matching-model.md` §8 — geospatial indexing, nearby queries                              | PostGIS `ST_DWithin(geography, geography, meters)` against the Phase 2 generated `Location.point`       |
| `docs/domain/ride-engine.md` §4.4 — discovery filters                                                 | Status + seat availability + pickup-within-radius only; no speculative filters                          |
| `docs/domain/matching-model.md` §5 — deterministic sort signal                                        | `ORDER BY pickup-to-pickup distance ASC` (nearest first); explicitly NOT a composite match score        |
| `docs/architecture/module-boundaries.md` §5 — Engine depends on Foundation + Database only            | Repository owns all SQL/PostGIS; application service orchestrates validation → query → mapping          |
| `docs/architecture/api-boundaries.md` §4 — no new error architecture                                  | Reuses `AppError` hierarchy (`lib/errors.ts`); `ValidationError` / `InternalError`                      |

## 3. Discovery input and validation

- `RideDiscoveryInput`: participant pickup `latitude`, `longitude`,
  `radiusMeters` (meters), optional `limit`. No invented filters
  (destination, departure time, vehicle type, preferences are matching
  concerns).
- Validation reuses the Phase 3.1 coordinate predicates
  (`isValidLatitude`/`isValidLongitude`) — bounds are not duplicated.
  `radiusMeters` must be finite and > 0; **no maximum radius is invented**
  (OD-004). `limit`, when provided, must be a positive integer.
- `DEFAULT_DISCOVERY_LIMIT = 20` is applied when `limit` is omitted. This is
  an **implementation decision** (a safety/performance guard for candidate
  retrieval), not a product decision — no documented limit exists. It is
  kept configurable per call.

## 4. Spatial query approach

- Raw SQL via `Prisma.sql` (parameterized bind parameters only — no user
  input is ever concatenated into SQL). Prisma cannot express the PostGIS
  geography operation natively.
- Participant point: `ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography`.
  **Coordinate order is `longitude, latitude`** — identical to the Phase 2
  generated column (`migration.sql`: `ST_MakePoint(longitude, latitude)`).
  A regression test pins this (see §9).
- Filter: `ST_DWithin(participant_geography, "Location"."point"::geography, radiusMeters)`
  — geography-aware, meter-based, inclusive at `distance <= radius`
  (verified empirically: a ride placed exactly 1000 m away is returned with
  a 1000 m radius).
- Distance returned: `ST_Distance(geography, geography)` in meters as
  `distanceMeters` — **pickup-to-pickup** distance, unrelated to the ride's
  stored route distance (`estimatedDistanceKm`) and never overwriting it.
- Status filter uses `r."status"::text IN (...)` because a custom Postgres
  enum column has no implicit equality operator with a text bind parameter.

### Index usability (verification result)

`EXPLAIN` on the final query shows the spatial predicate applied as a
**Filter** on the pickup `Location` lookup (resolved via `Location_pkey`
through `Ride.pickupLocationId`), **not** via the GiST index
`Location_point_idx`. Reason: the GiST index is on the `geometry` column,
while the meter-based search casts `point::geography` (a different
expression; only a GiST index on that expression would be used). This is
**correctness-first**: no index change was made because there is no
demonstrated performance/schema defect at Phase 3.3 scale, and changing
Phase 2 indexes requires a demonstrated real defect per the phase boundary.
The alternative — geometry `ST_DWithin` in degree units — would use the
index but is latitude-approximate for meters and was rejected. Note: a
future geography expression index (`point::geography`) would accelerate the
meter-based filter if/when a real performance requirement appears.

## 5. Eligible ride rules

- Status: `PUBLISHED` or `CONFIRMED` only (`matching-model.md` §3).
- Seats: `totalSeats − SUM("RideParticipant"."seatsAllocated" WHERE status = 'CONFIRMED') > 0`,
  computed in SQL (read-only). This is the documented availability rule
  (`ride-engine.md` §4.8 — available seats = total seats − confirmed
  participants); no second seat model is introduced and nothing is mutated.
- `DRAFT` and terminal (`COMPLETED`/`CANCELLED`/`EXPIRED`) rides are never
  returned.

## 6. Distance semantics

- `distanceMeters` = great-circle (WGS84 geography) pickup-to-pickup
  distance from the participant's requested point to the ride's pickup.
- It is **not** route distance and **not** estimated contribution; it never
  touches `estimatedDistanceKm`/`estimatedContribution`.

## 7. Repository / application separation

- `infrastructure/ride.repository.ts` — `discoverNearbyRides(client, query)`
  owns all Prisma/PostGIS/SQL details and returns raw typed rows.
- `application/discover-rides.ts` — `discoverRides(input, deps)` validates,
  resolves the query (default limit), calls the repository, and maps rows to
  the strongly typed `DiscoveredRide` result (no raw Prisma/Decimal types).
- Result fields: `id`, `creator {id, name}`, `pickupLocation`, `destinationLocation`,
  `departureDateTime`, `totalSeats`, `availableSeats`, `pricingType`,
  `pricePerKm`, `distanceMeters`. Sufficient for a future matching layer;
  no sensitive or internal-only fields.
- Sorting: nearest pickup first (`ORDER BY distanceMeters ASC`). This is a
  simple deterministic presentation order, explicitly not a match score.

## 8. Read-only guarantee

Discovery performs no writes — no Ride/seat/status mutations, no
`RideRequest`/`RideParticipant`, no `RideStatusHistory`, no notifications.
An integration test snapshots domain-table counts before/after and asserts
they are unchanged.

## 9. Testing

- **Unit** (`application/discover-rides.test.ts`, 15 tests, no DB): valid
  coordinates, invalid lat/lng (out-of-range/NaN/Infinity), zero/negative/
  NaN/Infinity radius, non-positive/non-integer limit, default limit
  application, result mapping, AppError propagation, unexpected-failure
  wrapping, and the "no matching logic" guarantee (results pass through
  unchanged in repository order, no score/rank fields).
- **Integration** (`infrastructure/discovery.integration.test.ts`, 11 tests,
  real Postgres/PostGIS): within-radius returned, outside excluded, DRAFT
  excluded, terminal excluded, CONFIRMED-with-seats returned, seat-ineligible
  excluded + `availableSeats` reported, radius-in-meters + boundary
  semantics, multiple rides nearest-first, distance accuracy, read-only, and
  result limit.
- **Coordinate-order regression (mandatory):** a ride sharing the
  participant's exact coordinates must be discovered, while a ride whose
  stored coordinates are the transposed pair (lat=77.5946, lon=12.9716 —
  ~7,400 km away at 77.6°N, 13°E) must not. A swapped `ST_MakePoint` order
  would fail this test.
- Test fixtures calibrate "meters north" against PostGIS itself (meters per
  degree at the base point) so exact-boundary assertions are reliable.

## 10. Assumptions / unresolved decisions (left untouched)

- Maximum/default search radius (OD-004) is **not** resolved — no maximum is
  enforced.
- No departure-time, destination, or vehicle-type filters (those are
  matching concerns with thresholds under OD-004).
- No pagination framework; only a deterministic per-call `limit`.
- No API, authentication, mobile UI, or any other Ride Engine capability.
