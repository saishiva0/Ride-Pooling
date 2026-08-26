# RidePool — Matching & Discovery Model

> Status: Phase 0 — Domain Definition
> Deterministic matching only. No AI/ML in V1.

## 1. Purpose

Ride discovery and matching determine which rides are shown to a participant
and in what order. V1 uses deterministic business rules so behaviour is
predictable and testable.

## 2. Conceptual Discovery Process

```
User location
  ↓
Search radius
  ↓
Candidate rides (status PUBLISHED or CONFIRMED with seats)
  ↓
Filter invalid rides
  ↓
Evaluate compatibility (pickup, destination, time, seats)
  ↓
Sort by relevance
  ↓
Display rides
```

## 3. Initial Filters

| Filter      | Behaviour                                         |
| ----------- | ------------------------------------------------- |
| Distance    | Ride pickup within participant's search radius    |
| Time        | Departure within an acceptable window             |
| Destination | Destination compatible (direction/tolerance)      |
| Seats       | Available seats ≥ 1 (or requested count)          |
| Price       | Price/km visible; optionally filtered             |
| Status      | Only `PUBLISHED` / `CONFIRMED` (with seats) rides |

## 4. Matching Factors (V1, deterministic)

Ranked in priority order:

1. **Pickup proximity** — participant within configured pickup radius of ride
   pickup.
2. **Destination compatibility** — participant's destination compatible with
   ride destination.
3. **Time compatibility** — departure within an acceptable window.
4. **Seat availability** — ride has available capacity.
5. **Ride status** — ride is active (`PUBLISHED` / `CONFIRMED` with seats).

## 5. Relevance Sorting

Deterministic sort signals (V1):

- Closer pickup → higher rank.
- Departure time closer to participant preference → higher rank.
- Final deterministic tie-break: ride ID ascending.

No numeric relevance score is used in V1 (OD-004 resolved in Phase 3.19): the
existing matching engine already provides deterministic, explainable factor
results and proximity ranking, and a weighted score would introduce arbitrary
weighting without additional product evidence. This keeps V1 transparent and
deterministic (ADR-007).

## 6. Thresholds — APPROVED V1 POLICY (OD-004, resolved Phase 3.19)

The following values are the approved V1 matching thresholds. They are
**server-controlled configuration** (see `docs/planning/open-decisions.md`
OD-004) — HTTP callers cannot supply them.

| Threshold                           | Approved V1 value                            |
| ----------------------------------- | -------------------------------------------- |
| Pickup search radius                | **5,000 meters** (inclusive at the boundary) |
| Departure time window               | **±60 minutes** (inclusive at the boundary)  |
| Destination compatibility tolerance | **5,000 meters** straight-line (inclusive)   |
| Relevance scoring                   | **No numeric score in V1**                   |
| Maximum returned matches            | **20** (server-owned)                        |

Ranking: 1. pickup distance ascending → 2. absolute departure-time difference
ascending → 3. ride ID ascending. Deterministic and explainable.

## 7. Information Required (Future Implementation)

Discovery will eventually require:

- Participant's latitude/longitude (or chosen pickup point).
- Search radius.
- Ride pickup/destination coordinates.
- Ride departure datetime.
- Ride available seats.
- Ride status.
- Price/km for display/filter.
- Distance calculation between points (see OD-007).
- Route compatibility data (straight-line fallback vs. actual routes — decision
  required).

## 8. Data Requirements

- Geospatial indexing for efficient "nearby" queries (PostgreSQL + PostGIS
  candidate).
- Precomputed or on-the-fly distance between participant and ride pickup.
- Destination compatibility computed per candidate.

## 9. Matching Model — What a "Relevant" Ride Means

A ride is considered relevant when:

- Participant is within the configured pickup radius.
- Destination is compatible.
- Departure time is within an acceptable window.
- Ride has available capacity.
- Ride is still active/published.

All five conditions are ANDed in V1.

## 10. Non-Goals

- No ML ranking.
- No personalized recommendations beyond the deterministic rules.
- No surge-aware ordering.
- No multi-modal matching.

## 11. Document Map

| Related doc                       | Purpose                                     |
| --------------------------------- | ------------------------------------------- |
| `docs/domain/ride-engine.md`      | Engine discovery/matching responsibilities  |
| `docs/domain/domain-model.md`     | Location model                              |
| `docs/planning/open-decisions.md` | OD-004 thresholds, OD-007 distance provider |
