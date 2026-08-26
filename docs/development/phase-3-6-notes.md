# Phase 3.6 — Request Acceptance / Rejection & Seat Allocation: Implementation Notes

> Status: Phase 3.6 — Implementation
> Records how ride request acceptance/rejection, participant creation, and
> high-concurrency seat allocation were built on top of Phase 3.5 (Ride
> Requests). `docs/domain/ride-lifecycle.md`, `docs/domain/ride-engine.md`,
> and `docs/domain/domain-model.md` are the authoritative specifications; this
> note records what was implemented and why, including the assumptions taken
> where the specs leave product decisions open. No product decision is
> resolved here.

## 1. Purpose and boundary

Phase 3.6 implements the **decision** side of the request lifecycle: the ride
creator accepts or rejects a `PENDING` `RideRequest`. Acceptance atomically:

1. validates the current request/ride/seat state,
2. creates a `RideParticipant` (status `CONFIRMED`) with `seatsAllocated =
requestedSeats` — this is the atomic seat allocation,
3. moves the request `PENDING → ACCEPTED` (`resolvedAt` set),
4. on the **first** accepted request, transitions the ride
   `PUBLISHED → CONFIRMED` and appends a `RideStatusHistory` row.

Rejection is deliberately minimal: `PENDING → REJECTED` (`resolvedAt` set),
with **no** participant, no seat change, and no ride status/history mutation.

It is NOT authentication, HTTP/API, notifications, cancellation, or
expiration (all later). `actorId` is trusted input, as `requesterId` was in
Phase 3.5.

```
Requests (Phase 3.5):  create RideRequest → PENDING
Requests (Phase 3.6):  accept/reject, participant + seat allocation — THIS PHASE.
Requests (3.7+):       notifications, API/auth, cancellation — NOT here.
```

## 2. Decision-eligible states (ride-lifecycle.md §6)

Only `PENDING` requests can be accepted or rejected; any other status is a
`ConflictError` (409). A historical `REJECTED` request does not block a new
request (Phase 2 partial index / Phase 3.5 behaviour, unchanged). The
integration test "allows a new request after a historical REJECTED one"
proves this stays true across the accept/reject flows.

Acceptance eligibility of the **ride** is identical to requestability:
`REQUESTABLE_RIDE_STATUSES` = `{PUBLISHED, CONFIRMED}` (`PUBLISHED` for the
first request, `CONFIRMED` while seats remain). `decision-rules.ts` reuses
this constant via `isAcceptableRideStatus` rather than duplicating it —
acceptance is the mirror of request creation.

## 3. Request and ride transitions implemented here

```
RideRequest:
  PENDING → ACCEPTED   (acceptance; resolvedAt set; participant created)
  PENDING → REJECTED   (rejection;  resolvedAt set; nothing else created)

Ride:
  PUBLISHED → CONFIRMED  (first accepted request, via the Phase 3.1 state
                          machine `transitionRideStatus`, never duplicated)
  CONFIRMED   stays CONFIRMED on subsequent accepts (no extra history row)
```

- `INITIAL_PARTICIPANT_STATUS = CONFIRMED` — matches `domain-model.md` §2.4
  and `ride-lifecycle.md` §6 ("ACCEPTED requests create a RideParticipant
  (status CONFIRMED)").
- `FIRST_ACCEPTED_REASON = 'First request accepted'` is the
  `RideStatusHistory.reason` for the PUBLISHED → CONFIRMED transition
  (Phase 3.2 convention: history is written by the actor changing status).
- `resolvedAt` is set on both accept and reject; it stays `NULL` on PENDING.

## 4. Seat allocation — the atomic availability rule

There is **no** `availableSeats` column and `totalSeats` is never modified.
Availability is always derived live:

```
availableSeats = totalSeats − SUM(seatsAllocated of CONFIRMED participants)
```

`countConfirmedParticipantSeats(rideId)` (a Prisma aggregate over
`RideParticipant`, status `CONFIRMED`) computes the sum inside the same
transaction that performs the decision. Acceptance requires
`requestedSeats ≤ availableSeats` (inclusive boundary), the same
`hasSufficientSeats` predicate Phase 3.5 uses. Seats allocated to a ride
that is later cancelled or whose participant is cancelled are Phase 3.7+
concerns; only `CONFIRMED` participants hold seats today.

## 5. Concurrency and the ride-row lock (the core guarantee)

The seat-race hazard: two accepts can both read "1 seat free" and both insert
a participant, overbooking the ride. This is prevented with a **row lock**:

- `lockRideForDecision(rideId)` runs
  `SELECT "id", "status", "totalSeats", "creatorId" FROM "Ride" WHERE "id" = $1 FOR UPDATE`
  (parameterized raw SQL — Prisma cannot express `FOR UPDATE`).
- **Every** decision (accept AND reject) locks the ride row **first**, then
  re-reads the request _after_ the lock is held. Because both use cases take
  the same lock in the same order (ride → request), concurrent decisions for
  one ride are fully serialized and cannot deadlock.
- The authoritative snapshot is therefore: request re-read under the lock +
  confirmed-seat sum computed under the lock + participant insert under the
  lock, all inside one `prisma.$transaction`.

Net effect: for a ride with `totalSeats = 1` and two concurrent 1-seat
accepts, exactly one wins; the second reads a freshly-updated state and fails
with `BusinessRuleError`. Proven by `concurrency.integration.test.ts`
(TEST A–D) which races real operations and then verifies the final database
state, including that confirmed seats never exceed `totalSeats` and the
accepted-request ↔ participant relationship stays 1:1.

## 6. Duplicate participant protection — app check + DB constraints

Two database unique indexes back this up (Phase 2 schema, **no change**):

1. `RideParticipant_requestId_key` — one participant per request.
2. The partial unique index over `(rideId, userId)` for CONFIRMED
   participants — one confirmed seat-holder per (ride, user).

The application pre-checks `findParticipantByRequest` inside the transaction
(defense in depth), and the indexes are the final arbiter of races: a `P2002`
during `persistRideParticipant` is translated to `ConflictError` via the
shared `classifyRideRequestError`. The losing concurrent operation never
double-allocates seats. The integration test "the requestId unique index
rejects a second participant and classifyError maps it" inserts directly to
prove the constraint remains effective.

## 7. Actor rules

- The requester **cannot** accept or reject their own request:
  `BusinessRuleError` (422) — same rationale as the Phase 3.5 self-request
  rule.
- Only the ride creator may decide (`ride.creatorId === actorId`):
  `AuthorizationError` (403). This is business-level authorization; real
  authentication is a later phase, so `actorId` is trusted input.

## 8. Error model (reused from lib/errors.ts)

| Condition                                                | Error                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| Malformed input (empty `requestId` / `actorId`)          | `ValidationError` (400)                                      |
| Missing request / ride (or P2003 race)                   | `NotFoundError` (404)                                        |
| Requester == actor / ride not accepting / no seats       | `BusinessRuleError` (422)                                    |
| Actor is not the ride creator                            | `AuthorizationError` (403)                                   |
| Request not PENDING / participant already exists (P2002) | `ConflictError` (409)                                        |
| Anything else                                            | `InternalError` (500), wrapping the cause — never leaked raw |

Every error carries a `field` and structured `details` for a future API layer
(the same convention as Phase 3.5).

## 9. Transactionality and rollback

Each decision runs inside a single `prisma.$transaction` (via the shared
`RideRequestDecisionPersistence` port, mirroring the Phase 3.5 pattern). If
any step fails, the whole decision is rolled back. The integration test
"rolls back participant, request, ride status, and history when a later write
fails" forces a foreign-key failure on the history insert after participant
creation and verifies **no** participant, request update, ride status change,
or history row survives.

## 10. Architecture and separation of concerns

```
accept-ride-request.ts / reject-ride-request.ts (use cases — Phase 3.6)
  └─ ride-request-decision.ts (shared plumbing)
       ├─ RideRequestDecisionInput           {requestId, actorId}
       ├─ assertValidDecisionInput           (shape only)
       ├─ RideRequestDecisionPersistence     (Prisma-free port)
       │    ├─ findRequest / lockRideForDecision (FOR UPDATE)
       │    ├─ countConfirmedSeats / findParticipantByRequest
       │    ├─ createParticipant / updateRequestStatus
       │    ├─ updateRideStatus / createStatusHistory
       │    └─ classifyError                 (P2002 → unique, P2003 → foreign_key)
       ├─ createRideRequestDecisionPersistence(tx)   → binds port to a tx client
       └─ defaultRideRequestDecisionDependencies()   → prisma.$transaction
  └─ domain rules (domain/decision-rules.ts, pure):
       INITIAL_PARTICIPANT_STATUS · isPendingRequest · isAcceptableRideStatus ·
       hasAvailableSeats · canAcceptRequest · canRejectRequest
       (reuses REQUESTABLE_RIDE_STATUSES / hasSufficientSeats from
        domain/request-rules.ts and transitionRideStatus from the Phase 3.1
        state machine — no duplicated rules)
```

- All Prisma/raw-SQL details live in `infrastructure/ride.repository.ts`
  (`findRideRequest`, `lockRideForDecision`, `countConfirmedParticipantSeats`,
  `findParticipantByRequest`, `persistRideParticipant`,
  `updateRideRequestStatus`, `updateRideStatus`,
  `persistRideStatusHistory`), each taking a `Prisma.TransactionClient`.
- No HTTP, Express, controllers, routes, auth, or notifications.
- **No schema change**: Phase 2's `RideParticipant`/`RideRequest` models,
  their unique indexes, and CHECK constraints already cover everything.

## 11. Concurrency guarantees (verified, not assumed)

The `concurrency.integration.test.ts` suite races real operations and then
checks the database:

- **TEST A** — `totalSeats = 1`, two 1-seat requests accepted concurrently →
  exactly one success; confirmed seats == 1, never > 1.
- **TEST B** — `totalSeats = 2`, one 2-seat + one 1-seat request →
  exactly one success; confirmed seats never exceed 2. **Note**: which request
  wins is nondeterministic (both wait on the same `FOR UPDATE` lock, then the
  loser sees 0 free seats). The spec's "confirmed seats = 2" is interpreted as
  the safety invariant "confirmed seats never exceed totalSeats", which is what
  the row lock guarantees.
- **TEST C** — the same request accepted twice concurrently → exactly one
  participant, no double allocation (`RideParticipant_requestId_key` + P2002 →
  ConflictError).
- **TEST D** — concurrent accept + reject of the same request → exactly one
  terminal outcome; participant exists only if acceptance won.
- After every test, an invariant check asserts the accepted-request ↔
  participant relationship is 1:1 and the unique indexes hold.

## 12. Testing

- **Unit** (`domain/decision-rules.test.ts`, `application/accept-ride-request.test.ts`,
  `application/reject-ride-request.test.ts`, no DB): constants
  (`INITIAL_PARTICIPANT_STATUS`, `FIRST_ACCEPTED_REASON`), pending/acceptable/
  seat predicates, combined `canAcceptRequest`/`canRejectRequest`, happy-path
  result mapping, input validation before any persistence, requester==actor,
  non-creator authorization, non-PENDING conflict, unacceptable ride status,
  insufficient seats, duplicate participant, correct ride transition on first
  accept (and none after), request re-read after the lock, error translation
  (AppError passthrough, P2002 → ConflictError, P2003 → NotFoundError,
  unexpected → InternalError).
- **Integration** (`infrastructure/decision.integration.test.ts`, real DB):
  participant/request/ride/history persistence + the PUBLISHED → CONFIRMED
  transition, second accept keeps CONFIRMED with no extra history, non-creator
  decisions, already-accepted duplicate, stale-request insufficient seats with
  no partial mutation, rejection creating nothing, terminal re-reject,
  historical REJECTED then new request, raw DB duplicate-participant insert +
  `classifyError`, and the mid-transaction rollback.
- **Concurrency** (`infrastructure/concurrency.integration.test.ts`, real DB):
  TEST A–D above plus the post-race 1:1 invariant check.

Fixture coordinates in the two new integration files use a Hyderabad base,
deliberately > 400 km from the Bengaluru BASE used by the Phase 3.3/3.4
integration fixtures, so these rides can never compete for the discovery
result limit (`DEFAULT_DISCOVERY_LIMIT = 20`) inside its 8 km search radius.

## 13. Open decisions left untouched

All OD-001…OD-019 items remain open (notifications, payment, cancellation,
expiration/grace window OD-002, etc.). Rejection reasons, accept/reject
notifications, seat release on cancellation, and requester-initiated
cancellation are all later phases / open product decisions.

## 14. Assumptions

- The requester cannot accept/reject their own request (mirrors the Phase 3.5
  self-request rule); only the ride creator (`Ride.creatorId`) may decide.
- Acceptance eligibility == requestability (`REQUESTABLE_RIDE_STATUSES`).
- Only `CONFIRMED` participants hold seats; availability is always derived
  live, never stored.
- `actorId` is trusted input (authentication is a later phase).
- "Active" request statuses remain exactly `{PENDING, ACCEPTED}` (Phase 2
  partial index); REJECTED is historical and frees the slot for a new request.

## 15. Limitations

- No notifications on accept/reject; no API/auth surface (`actorId` trusted).
- No request cancellation, no expiry/grace window (OD-002), no seat release
  on cancellation — all later phases.
- `lockRideForDecision` uses a raw SQL `SELECT ... FOR UPDATE`; this is the
  only place the repository bypasses Prisma's query builder (Prisma cannot
  express `FOR UPDATE`), and it is fully parameterized.
- Rejection reasons are not stored (no product decision requires one yet).
