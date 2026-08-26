# Ride Domain Core (Phase 3.1 / 3.4)

Pure, deterministic Ride Engine building blocks: the ride lifecycle state
machine, ride field validation rules (Phase 3.1), and the ride matching
domain (Phase 3.4). No database access, no HTTP, no notifications, no
events — see `docs/domain/ride-engine.md`, `docs/domain/ride-lifecycle.md`,
and `docs/domain/matching-model.md` for the authoritative specifications.
This directory does not duplicate that documentation; it implements it.

## Files

- `ride.types.ts` — re-exports `RideStatus`/`PricingType` from the Prisma
  client (single source of truth shared with the persistence layer) plus the
  small input shapes the rules below need.
- `ride-state-machine.ts` — the transition map and `transitionRideStatus`,
  `canTransitionRideStatus`, `getAllowedRideTransitions`,
  `isTerminalRideStatus`.
- `ride-rules.ts` — pricing config and field validators (`isValidSeatCount`,
  `isValidPricePerKm`, `isSameCoordinates`, `assertValidRideFields`). The
  coordinate predicates `isValidLatitude` / `isValidLongitude` are
  centralized in the Location & Maps module
  (`modules/location/domain/coordinate.ts`, Phase 3.12) and re-exported here
  so this module's public surface is unchanged — validation lives in exactly
  one place.
- `ride.errors.ts` — `RideTransitionError` (illegal state transition,
  business rule violation) and `RideValidationError` (invalid ride field),
  both built on the existing `AppError` hierarchy in `src/lib/errors.ts`.
- `matching/` — the Phase 3.4 matching domain: `types.ts` (input, candidate,
  configuration, factor results), `distance.ts` (straight-line great-circle
  distance for destination compatibility), `factors/` (one pure function per
  documented factor), `evaluate.ts` (ANDed eligibility decision), `rank.ts`
  (deterministic relevance sort + candidate-id tie-break). Thresholds arrive
  as `MatchingConfiguration`; the domain never chooses a product value —
  since Phase 3.19 (OD-004 resolved) the application layer builds that
  configuration from server-controlled config with the approved V1 values
  (5000 m / ±60 min / 5000 m). See `docs/development/phase-3-4-notes.md` and
  `docs/development/phase-3-19-notes.md`.

## Adding a transition safely

1. Confirm the transition is documented in `docs/domain/ride-lifecycle.md`
   (§2 state descriptions, §3 diagram, §4 cancellation paths, §5 expiration).
   If it isn't documented there, it doesn't belong here — update the domain
   doc first (a separate, deliberate decision), don't add it silently.
2. Add the destination status to the `Set` for the source status in
   `RIDE_TRANSITIONS` (`ride-state-machine.ts`). Update the doc comment
   above the map.
3. Add a case to the exhaustive transition-matrix test in
   `ride-state-machine.test.ts` (it asserts every `(from, to)` pair against
   an explicit expected map, so a new transition must be reflected there or
   the test will fail).

## Why the state machine is pure

The state machine only answers "is `from → to` allowed, and what results?".
It performs no database writes, emits no `RideStatusHistory` rows, and sends
no notifications. This keeps it trivially unit-testable (no PostgreSQL
required) and reusable by whatever orchestrates real transitions later. A
future Ride application service will combine this state machine with a
database transaction, `RideStatusHistory` writes, and domain events — that
orchestration is explicitly out of scope for Phase 3.1
(`docs/domain/ride-engine.md` §6 concurrency notes apply to that later
layer, not to this pure function).
