# Phase 3.4 — Ride Matching: Implementation Notes

> Status: Phase 3.4 — Implementation
> Records how Ride Matching was built on top of Phase 3.3 (Ride Discovery).
> `docs/domain/matching-model.md` is the authoritative specification; this
> note records what was implemented and why, including the additive change
> to Phase 3.3 discovery output. No product decision is resolved here.

## 1. Purpose and boundary

Matching answers **"how well does each discovered ride fit the participant's
requested journey?"** It operates on candidates produced by discovery
(`DiscoveredRide[]`), evaluates the five documented factors, applies the
documented eligibility decision, and ranks deterministically. It is NOT
discovery (never queries the database, never re-runs the PostGIS search) and
NOT request creation (no `RideRequest`, no seat mutation, no participants).

```
Discovery (Phase 3.3): "which rides are nearby and eligible?"
Matching (Phase 3.4):  "how well does each discovered ride fit the journey?"
Requests (Phase 3.5):  create RideRequest — NOT implemented here.
```

## 2. Additive change to Phase 3.3 (required by the model)

`docs/domain/matching-model.md` §4 lists **ride status** as matching factor 5,
and §9 ANDs all five factors. Phase 3.3 discovery filtered status in SQL but
did not return it. To make factor 5 evaluable from discovery output, the
discovery result now carries the ride status:

- `DiscoveredRideRow.status` / `DiscoveredRide.status`
  (`infrastructure/ride.repository.ts`, `application/discover-rides.ts`).
- The query selects `r."status"::text` (the custom enum is cast to text so
  `$queryRaw` returns a plain string).

This is an **additive** field — discovery behaviour is unchanged (same
status/seat/radius filters, nearest-first order, read-only, limit). Discovery
unit/integration tests were updated for the new field only.

## 3. Matching factors implemented (matching-model.md §4)

All five documented factors, in documented priority order, each a pure
function under `domain/matching/factors/`:

| #   | Factor                    | Implementation                                                                                                |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Pickup proximity          | `pickupDistanceMeters <= pickupRadiusMeters` — reuses discovery's pickup-to-pickup distance; never recomputed |
| 2   | Destination compatibility | straight-line distance participant destination → ride destination `<= destinationToleranceMeters` (see §8)    |
| 3   | Time compatibility        | `                                                                                                             | preferredDeparture − departure | `in minutes`<= departureTimeWindowMinutes` (UTC-absolute, timezone-agnostic) |
| 4   | Seat availability         | `availableSeats >= requestedSeats` (default 1) — reuses discovery's value; matching never modifies seats      |
| 5   | Ride status               | `status ∈ {PUBLISHED, CONFIRMED}` — evaluated from the carried status                                         |

No additional factors were invented; none were removed.

## 4. Scoring model — deliberately absent

`matching-model.md` §5: "Exact scoring formula = **PRODUCT DECISION
REQUIRED** (OD-004)"; §6 also marks the "relevance scoring weights" as
PRODUCT DECISION REQUIRED. **No numerical score is implemented** — the model
does not define one and the phase instruction forbids introducing one "merely
because ranking seems convenient". Results carry an eligibility decision and
per-factor outcomes, not a score.

## 5. Eligibility decision (matching-model.md §9)

A candidate is `eligible` only when **all five** factors pass (conditions are
ANDed in V1). `evaluateCandidateMatch` returns the ANDed decision plus all
five factor results in priority order.

## 6. Threshold handling (OD-004 — PRODUCT DECISION REQUIRED)

All thresholds are **required `MatchingConfiguration` input** supplied by the
caller; the domain and application layers never silently choose a value:

- `pickupRadiusMeters`
- `departureTimeWindowMinutes`
- `destinationToleranceMeters`

There are no defaults. The model's §6 "initial candidate suggestions"
(5–10 km, ±60 min, ~5 km) are explicitly "to be validated, not committed"
and are NOT used. Config shape validation (positive finite numbers;
destination tolerance `>= 0`) is application-layer, not a product choice.

## 7. Ranking (matching-model.md §5) and tie-breaking

§5 defines two deterministic sort signals: "Closer pickup → higher rank" and
"departure time closer to participant preference → higher rank". With no
scoring formula, ranking is an explicit **lexicographic sort**:

1. `pickupDistanceMeters` ASC (primary — pickup proximity is factor 1)
2. `timeProximityMinutes` ASC (`|departure − preferred|`, secondary)
3. `candidateId` ASC (explicit, documented tie-break — never database row
   order, never random)

Ranking is independent of eligibility and of the input array order. This is a
deterministic reading of §5; the exact formula/weights remain OD-004.

## 8. Distance semantics and the OD-007 dependency

- **Pickup distance**: reused from discovery (`DiscoveredRide.distanceMeters`)
  — never recomputed, no duplicate PostGIS work.
- **Destination distance**: needed by factor 2 and not provided by discovery,
  so matching computes a **straight-line great-circle distance** in a pure
  function (`domain/matching/distance.ts`). `matching-model.md` §7 names the
  "straight-line fallback vs. actual routes" approach with the decision
  deferred; this implements the documented straight-line fallback only. The
  computation is isolated in one function so the actual-route variant can be
  swapped when OD-007 is decided. **OD-007 remains open** — no routing/maps
  provider is called or invented.
- `estimatedDistanceKm` / `estimatedContribution` are untouched by matching.

## 9. Explainability (Phase 3.4 §13)

Every factor returns a structured `FactorResult`: `factor` (canonical id from
`MATCH_FACTOR_IDS`), `eligible`, a deterministic `reason`, plus `value`
(measured quantity) and `threshold` when applicable. A future UI can explain
a strong or weak match from structured data — no opaque strings.

## 10. Architecture and separation of concerns

```
discover-rides.ts            (Phase 3.3 application)   → DiscoveredRide[]
match-rides.ts               (Phase 3.4 application)   → MatchedRide[]
  ├─ assertValidMatchingInput / assertValidMatchingConfig
  ├─ toMatchCandidate → domain/matching/types (MatchCandidate)
  ├─ evaluateCandidateMatch (domain/matching/evaluate.ts, pure)
  │    ├─ factors/pickup-proximity.ts        (pure)
  │    ├─ factors/destination-compatibility.ts (pure)
  │    ├─ factors/time-compatibility.ts      (pure)
  │    ├─ factors/seat-availability.ts       (pure)
  │    └─ factors/ride-status.ts             (pure)
  └─ rankMatches (domain/matching/rank.ts, pure)
```

- `matchRides` is **synchronous and side-effect free**: no database, no
  network, no logging, no mutation. Fully unit-testable without PostgreSQL.
- The domain `MatchCandidate` type (id, status, departure, available seats,
  pickup distance, destination coordinates) is a reduction of `DiscoveredRide`
  — the application layer maps between them, keeping domain free of Prisma and
  application types. `RideCoordinates` is reused (no duplicate Location model).
- `MatchedRide` preserves the full `DiscoveredRide` for the future
  RideRequest/UI layers plus the decision and factor results.

## 11. External dependencies

None. No maps, routing, geocoding, notifications, payments, AI/ML, or HTTP.
The only external dependency is PostgreSQL/PostGIS, reached through discovery
(before matching) — matching itself makes zero database calls.

## 12. Testing

- **Unit** (`domain/matching/*.test.ts`, `application/match-rides.test.ts`):
  every factor (normal/boundary/invalid), eligibility ANDing, factor order,
  requested-seats handling, ranking signals, tie-breaking, determinism
  (repeated executions identical), input-order independence, zero/single
  candidates, input and config validation, no-Prisma-type leak.
- **Integration** (`infrastructure/matching.integration.test.ts`, real DB):
  discovery → matching end-to-end, status carried through discovery, type-safe
  results (no raw Prisma types), eligibility decisions, ranking, and a
  strict-tolerance case. Fixtures cleaned up in `afterAll`.

## 13. Open decisions left untouched

OD-004 (all matching thresholds, scoring weights) — enforced as required
config, never resolved. OD-007 (map/distance provider) — straight-line
fallback used, actual routes deferred. All other OD-001…OD-019 unresolved.

## 14. Assumptions

- Ranking is lexicographic (pickup, then time proximity, then id) as the
  deterministic reading of §5's two sort signals.
- Destination compatibility uses the straight-line fallback (§8); the
  "on-route / detour" variant is not implemented (OD-007).
- `requestedSeats` defaults to 1 when omitted (matching-model.md §3).
- Matching returns all candidates (eligible and ineligible) with structured
  reasons; the future UI/request layer decides what to display/act on.

## 15. Limitations

- No score/weights (blocked by OD-004 by design).
- No routing-based destination or detour evaluation (OD-007).
- Pickup-distance reuse means matching inherits discovery's pickup geometry
  semantics (great-circle, not road distance).
- No pagination/caching: matching is an in-memory pass over the candidates it
  is given.
