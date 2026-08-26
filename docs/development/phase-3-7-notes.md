# Phase 3.7 — Ride Cancellation & Expiration: Implementation Notes

> Status: Phase 3.7 — Implementation
> Records how ride cancellation and expiration were built on top of Phase 3.6
> (request acceptance/rejection + seat allocation). `docs/domain/ride-lifecycle.md`,
> `docs/domain/ride-engine.md`, and `docs/domain/domain-model.md` are the
> authoritative specifications; this note records what was implemented and
> why, including the assumptions taken where the specs leave product decisions
> open. No product decision is resolved here (OD-002 stays OPEN).

## 1. Purpose and boundary

Phase 3.7 implements the **cancellation** and **expiration** of rides as pure
domain/application operations, reusing the Phase 3.1 state machine and the
Phase 3.6 ride-row locking convention. It is NOT notifications, HTTP/auth,
scheduled-job/cron infrastructure, request cancellation, or seat release
(all later). Cancellation/expiration only change ride state + `RideStatusHistory`.

```
Cancellation (this phase): ride creator → DRAFT/PUBLISHED/CONFIRMED/IN_PROGRESS → CANCELLED.
Expiration (this phase):   system evaluation → PUBLISHED (departure passed) → EXPIRED.
```

## 2. State transitions used (reused, not duplicated)

The Phase 3.1 state machine already contains every transition this phase
needs; nothing was added to it:

- `DRAFT → CANCELLED`, `PUBLISHED → CANCELLED`, `CONFIRMED → CANCELLED`,
  `IN_PROGRESS → CANCELLED` (`ride-lifecycle.md` §2.1–§2.4).
- `PUBLISHED → EXPIRED` (`ride-lifecycle.md` §2.2/§2.7, §5).

`transitionRideStatus()` produces the resulting state in both use cases —
never a bypass. `canCancelRide` is a thin, named wrapper over
`canTransitionRideStatus(status, CANCELLED)`, so cancellation eligibility is
identical to the documented transition map (`DRAFT`/`PUBLISHED`/`CONFIRMED`/
`IN_PROGRESS` allowed; `COMPLETED`/`CANCELLED`/`EXPIRED` rejected). The
`ride-state-machine.test.ts` (70 tests) continues to cover illegal-transition
rejection.

## 3. Cancellation rules

- Source states: exactly the four the state machine allows
  (`cancellation-rules.ts` → `canCancelRide`).
- Actor: the ride creator only (`ride.creatorId === actorId`). `actorId` is
  trusted input (no authentication), consistent with Phase 3.6.
- The requester/creator distinction does not apply (the creator owns the
  ride; there is no "self-cancel" analogue).
- Repeated cancellation of an already-terminal ride → `BusinessRuleError`
  (422) with the current status in `details` — the same ride-state-error
  convention Phase 3.6 uses for a ride in a non-accepting state. No duplicate
  history row is ever written.

## 4. Expiration rules

- Eligibility is split from policy (Phase 3.7 §9–§11):
  - **Logic** (`expiration-rules.ts`, pure): only `PUBLISHED` rides
    (`EXPIRABLE_RIDE_STATUSES`) whose departure window has passed may expire;
    `CONFIRMED`/`IN_PROGRESS`/`DRAFT` and terminal states never expire.
  - **Policy**: the grace window is OD-002 (OPEN). It is passed as explicit
    input (`graceWindowMs`), defaulting to `DEFAULT_RIDE_EXPIRATION_GRACE_MS
= 0` — exactly `ride-lifecycle.md` §2.7's literal entry condition
    ("departure datetime has passed") with `grace_window = 0` in §5's
    candidate rule. No arbitrary grace period is hardcoded; the constant is
    documented policy to replace when OD-002 is decided.
- Reference time is injected (`referenceTime`) — never `new Date()` inside
  domain rules — so time-dependent behaviour is deterministic and tested with
  fixed timestamps.
- Expiration is **idempotent and safe**: an ineligible ride (already EXPIRED,
  another terminal state, `CONFIRMED`, future departure, or inside the grace
  window) is returned unchanged with `statusChanged: false` and NO history
  row. Running it twice never duplicates history or re-transitions.

## 5. Transaction and locking strategy

Each operation runs inside a single `prisma.$transaction` via the shared
`RideLifecyclePersistence` port (`application/ride-lifecycle.ts`, mirroring
`ride-request-decision.ts`). Both use cases first lock the ride row with
`lockRideForLifecycle` (`SELECT ... FOR UPDATE` — parameterized raw SQL; the
same lock primitive and the same ride row as Phase 3.6's
`lockRideForDecision`), then act on the authoritative state read under the
lock:

- Atomic writes: `updateRideStatus` + `persistRideStatusHistory` succeed or
  fail together; a failed write rolls back the ride status AND the history
  (no partial history, no duplicate).
- Lock-order discipline (ride row → writes) is identical across accept/reject/
  cancel/expire, so no deadlock is possible and no illegal state can be
  produced.

## 6. Cancellation and participants / requests

Per the phase boundary (Phase 3.7 §7/§8), cancellation does NOT modify
`RideRequest`/`RideParticipant`/`User`/`Location` rows, does not touch
`totalSeats`, and introduces no seat-release fields. Existing confirmed
participants remain historically represented. A cancelled ride is simply no
longer requestable (its status leaves `REQUESTABLE_RIDE_STATUSES` =
`{PUBLISHED, CONFIRMED}`) and no longer discoverable (discovery's
`DISCOVERABLE_RIDE_STATUSES`). Request cancellation / seat release are later
phases.

## 7. Discovery behaviour

Discovery already filters to `PUBLISHED`/`CONFIRMED`
(`DISCOVERABLE_RIDE_STATUSES`), so after `PUBLISHED → CANCELLED`,
`PUBLISHED → EXPIRED`, and `CONFIRMED → CANCELLED` the ride no longer
appears. No discovery code was changed; the integration tests verify this
end-to-end (a ride discoverable while `PUBLISHED` disappears after
cancel/expire).

## 8. Status history

- Cancellation: `{ rideId, fromStatus, toStatus: CANCELLED, changedByUserId:
actorId, reason: 'Ride cancelled by creator' }` (`RIDE_CANCELLED_REASON`).
- Expiration: `{ rideId, fromStatus, toStatus: EXPIRED, changedByUserId: null,
reason: 'Ride expired: departure passed unstarted' }` — the system is the
  actor (`ride-lifecycle.md` §2.7), so `changedByUserId` is null (the column
  is nullable; `persistRideStatusHistory` was widened to accept `string |
null`).
- History is written only when the transition actually happens; expiration
  no-ops write nothing, so repeat runs never duplicate rows.

## 9. Concurrency guarantees (verified, not assumed)

`lifecycle.integration.test.ts` races real operations against PostgreSQL and
verifies final state:

- **cancel vs cancel** → exactly one success + one `BusinessRuleError`; final
  `CANCELLED`; exactly one history row.
- **cancel vs expire** → exactly one terminal state (`CANCELLED` or
  `EXPIRED`), never `PUBLISHED`; exactly one terminal history row matching the
  winner. If cancel wins, expire no-ops (`statusChanged: false`); if expire
  wins, cancel rejects with `BusinessRuleError`.
- **expire vs expire** → exactly one `EXPIRED` transition, the other no-ops;
  one history row.

The ride-row lock serializes every operation per ride, so final state is
always valid (no illegal ride status, no overbooking, no duplicate history).

## 10. Repository design

Extended `infrastructure/ride.repository.ts` minimally:

- `lockRideForLifecycle` (new) — `SELECT ... FOR UPDATE` returning
  `{ id, creatorId, status, departureDateTime }` (expiration needs the
  departure datetime; `lockRideForDecision` is left untouched for Phase 3.6).
- `classifyRideLifecycleError` (new) — P2025 → `not_found`, P2003 →
  `foreign_key` (the decision classifier only handled P2002/P2003).
- `persistRideStatusHistory` (widened) — `changedByUserId: string | null`.

No generic repository abstraction; no Prisma types leak through
application/domain APIs.

## 11. Error model (reused from lib/errors.ts)

| Condition                                                       | Error                          |
| --------------------------------------------------------------- | ------------------------------ |
| Malformed input (empty rideId/actorId, bad referenceTime/grace) | `ValidationError` (400)        |
| Missing ride (or P2025/P2003 race)                              | `NotFoundError` (404)          |
| Actor is not the ride creator                                   | `AuthorizationError` (403)     |
| Ride status cannot be cancelled (terminal)                      | `BusinessRuleError` (422)      |
| Unexpected persistence failure                                  | `InternalError` (500), wrapped |

Expiration never errors on an ineligible ride — it returns
`statusChanged: false` (idempotent). Raw Prisma errors never leak.

## 12. OD-002 handling

OD-002 ("exact cancellation windows / grace periods / expiration grace for
ride states") remains OPEN. No value was chosen: the grace window is explicit
input to `expireRide` (`graceWindowMs`) defaulting to a documented 0 baseline
(the literal "departure passed" rule), and the docs/notes record it as
unresolved. Cancellation grace windows are likewise untouched.

## 13. Testing

- **Unit** (`domain/cancellation-rules.test.ts` 8, `domain/expiration-rules.test.ts`
  16, `application/cancel-ride.test.ts` 14, `application/expire-ride.test.ts`
  16 — 54 tests, no DB): cancellable/terminal states, state-machine
  delegation, expirable statuses, departure-window boundaries with fixed
  timestamps, explicit grace-window policy, idempotent no-ops for ineligible
  rides, input validation, creator authorization, missing ride, correct
  status/history writes (system actor null for expiration), and error
  translation (P2025/P2003 → NotFoundError, unexpected → InternalError).
- **Integration** (`infrastructure/lifecycle.integration.test.ts` — 15 tests,
  real DB): cancel from PUBLISHED (status + history + preserved creator/
  locations + non-discoverability), CONFIRMED (participant preserved), DRAFT,
  IN_PROGRESS, non-creator, missing ride, repeated cancel (no duplicate
  history); expire eligible PUBLISHED (status + history + non-discoverability),
  idempotent repeat, ineligible unchanged (CONFIRMED/future/CANCELLED), grace
  window policy input; and the three concurrency races above.

Fixture coordinates use a dedicated base point (offset from the Phase 3.6
Hyderabad fixtures and >400 km from the Bengaluru discovery fixtures) so no
cross-file discovery-limit interference occurs; discovery regression queries
are scoped to this file's ride ids with an explicit limit.

## 14. Files changed

- **New**: `domain/cancellation-rules.ts`, `domain/expiration-rules.ts`,
  `application/ride-lifecycle.ts`, `application/cancel-ride.ts`,
  `application/expire-ride.ts`, and their unit tests +
  `infrastructure/lifecycle.integration.test.ts`.
- **Modified**: `infrastructure/ride.repository.ts` (see §10).
- **Schema**: none.

## 15. Open decisions left untouched

OD-001…OD-019 remain open, especially OD-002 (see §12). Request cancellation,
seat release on cancellation, participant cancellation (incl. the
`CONFIRMED → PUBLISHED` revert, OD-011), notifications, and scheduled/lazy
expiration infrastructure are later phases.

## 16. Assumptions

- Only the ride creator may cancel; `actorId` is trusted input.
- Cancellation leaves requests/participants/history of participation intact
  (no request cancellation, no seat release this phase).
- Expiration is a pure operation; the trigger (scheduled/lazy) is out of scope.
- `changedByUserId = null` represents the system actor for expiration.

## 17. Limitations

- No request cancellation / seat release on ride cancellation (later phase).
- No notifications (RIDE_CANCELLED / RIDE_EXPIRED delivery is later).
- No scheduled/cron/lazy expiration job — only the atomic operation.
- Expiration grace window defaults to 0 pending OD-002 (explicit, documented).
