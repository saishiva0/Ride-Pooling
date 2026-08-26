# Ride Module

Layered structure, growing one capability at a time:

```
ride/
  domain/           Phase 3.1 — pure state machine + field validation rules
  domain/matching/  Phase 3.4 — pure matching factors, evaluation, ranking
  application/       Phase 3.2/3.3/3.4/3.5 — use cases orchestrating domain + infrastructure
  infrastructure/     Phase 3.2/3.3/3.5 — Prisma/PostGIS persistence
```

- **`domain/`** — pure, deterministic business rules (state machine, pricing
  validation, coordinate validation). No I/O. See `domain/README.md`.
- **`domain/matching/`** — pure matching domain: the five documented factors
  (`factors/`), destination distance (`distance.ts`), candidate evaluation
  (`evaluate.ts`), and deterministic ranking (`rank.ts`). No I/O.
- **`application/`** — use cases (`create-ride.ts`, `discover-rides.ts`,
  `match-rides.ts`, `create-ride-request.ts`). Orchestrate domain validation +
  infrastructure persistence; contain no business rules of their own beyond
  input-shape checks that don't belong in the domain layer (e.g. "is this a
  valid Date").
- **`infrastructure/`** — Prisma/PostGIS access for this module only
  (`ride.repository.ts`). Not a generic repository framework — just the
  functions Ride creation, discovery, and requests actually need.

## Ride creation flow (Phase 3.2)

```
RideCreationInput
  → application-level shape checks (create-ride.ts)
  → domain field validation (domain/ride-rules.ts, reused, not duplicated)
  → infrastructure: transactional persistence (infrastructure/ride.repository.ts)
      1. look up creator (User) — not found → rollback, NotFoundError
      2. create pickup Location
      3. create destination Location
      4. create Ride (status = DRAFT, per docs/domain/ride-lifecycle.md §2.1)
      5. create initial RideStatusHistory (fromStatus: null → toStatus: DRAFT)
  → CreatedRide (application-layer result; no raw Prisma types)
```

No HTTP layer, no authentication, and no other Ride Engine capability
(discovery is candidate retrieval only; matching, requests, participants,
notifications) exists yet. Those are separate, later phases.

## Ride discovery flow (Phase 3.3)

```
RideDiscoveryInput (latitude, longitude, radiusMeters, limit?)
  → application input validation (application/discover-rides.ts)
      · coordinates reuse domain/ride-rules.ts predicates (not duplicated)
      · radius finite + > 0 (server supplies the pickup radius for matching —
        OD-004, resolved Phase 3.19)
  → infrastructure: discoverNearbyRides() (infrastructure/ride.repository.ts)
      · PostGIS geography ST_DWithin, meter radius
      · ST_MakePoint(longitude, latitude) — coordinate order matches the
        Phase 2 generated column
      · status filter: PUBLISHED / CONFIRMED (docs/domain/matching-model.md §3)
      · seat filter: totalSeats − confirmed participant seats > 0
      · ORDER BY pickup distance ASC (nearest first), LIMIT
  → DiscoveredRide (strongly typed; no raw Prisma/Decimal types)
```

Discovery is READ ONLY and deliberately does NOT match or rank: it returns
geographically eligible candidates, nearest first. Matching is Phase 3.4.

## Ride matching flow (Phase 3.4 / Phase 3.19)

```
RideMatchingInput (destination, preferredDepartureTime, requestedSeats?)
  + MatchingConfiguration (OD-004 — resolved Phase 3.19: server-controlled
    approved thresholds 5000 m / ±60 min / 5000 m, built by
    application/matching-config.ts from central config; callers never supply)
  + DiscoveredRide[] (Phase 3.3 output; includes carried status)
  → application validation (application/match-rides.ts)
  → domain evaluation (domain/matching/evaluate.ts)
      · 5 factors, documented order (matching-model.md §4):
        pickup proximity · destination compatibility · time compatibility ·
        seat availability · ride status
      · eligible ⇔ all five ANDed (§9) — no score (OD-004 resolved: V1 uses
        no numeric relevance score)
  → deterministic ranking (domain/matching/rank.ts)
      · pickup distance ASC → time proximity ASC → candidate id ASC
  → server-owned result cap (default 20 — OD-004)
  → MatchedRide[] (candidate + eligible + structured factor results)
```

Matching is synchronous and side-effect free (no DB, no HTTP), takes
discovery's candidates directly, and ends at `MatchedRide[]`. Request
creation is Phase 3.5.

## Ride request creation flow (Phase 3.5)

```
RideRequestInput (rideId, requesterId, requestedSeats?)
  → application input validation (application/create-ride-request.ts)
  → ONE transaction (injectable runTransaction; default prisma.$transaction)
      1. find requester — missing → NotFoundError
      2. find ride + live availableSeats (raw SQL, discovery's seat formula)
         — missing → NotFoundError
      3. creator requesting own ride → BusinessRuleError
      4. ride not in {PUBLISHED, CONFIRMED} → BusinessRuleError
      5. requestedSeats > availableSeats → BusinessRuleError
      6. active request exists (PENDING/ACCEPTED) → ConflictError
         (DB partial unique index RideRequest_active_unique is the race safety net;
          P2002 → ConflictError, P2003 → NotFoundError, never a raw Prisma error)
      7. insert RideRequest with status PENDING (INITIAL_RIDE_REQUEST_STATUS)
  → CreatedRideRequest (strongly typed; no raw Prisma types)
```

Request creation is READ-ONLY toward Ride/Participant data and ends at a
`PENDING` request — no seat reservation, no participants, no accept/reject,
no notifications, no API. Those are later phases.
