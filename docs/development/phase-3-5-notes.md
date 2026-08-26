# Phase 3.5 — Ride Requests: Implementation Notes

> Status: Phase 3.5 — Implementation
> Records how Ride Request creation was built on top of Phase 3.4 (Ride
> Matching). `docs/domain/ride-lifecycle.md`, `docs/domain/ride-engine.md`,
> and `docs/domain/domain-model.md` are the authoritative specifications;
> this note records what was implemented and why, including the assumptions
> taken where the specs leave product decisions open. No product decision is
> resolved here.

## 1. Purpose and boundary

Requests answer **"can this participant join this ride?"** for a ride they
have already found (via discovery/matching). Phase 3.5 implements only the
**creation** side of the request lifecycle — validating documented rules and
persisting a `PENDING` request. It is NOT acceptance/rejection, participant
creation, seat reservation, notifications, authentication, or an HTTP/API
layer (all later).

```
Discovery (Phase 3.3): "which rides are nearby and eligible?"
Matching (Phase 3.4):  "how well does each discovered ride fit the journey?"
Requests (Phase 3.5):  create RideRequest → PENDING — this phase.
Requests (Phase 3.6+): accept/reject, seats, participants — NOT here.
```

## 2. Requestable ride states (ride-lifecycle.md §2.2/§2.3)

Only `PUBLISHED` and `CONFIRMED` rides accept requests (`CONFIRMED` only while
seats remain). `DRAFT` (not yet shared), `IN_PROGRESS` (journey started), and
the terminal states (`COMPLETED`, `CANCELLED`, `EXPIRED`) do not. Defined as
`REQUESTABLE_RIDE_STATUSES` in `domain/request-rules.ts`.

The live seat availability check (`availableSeats = totalSeats − confirmed
participants' allocated seats`) is computed in SQL inside `findRideForRequest`
using the same formula as Phase 3.3 discovery. Seat allocation on acceptance
is Phase 3.6 — requests are never reserved here.

## 3. Request lifecycle created here (ride-lifecycle.md §6)

Only the initial transition is implemented:

```
RideRequest:
  PENDING (created here)
  → ACCEPTED / REJECTED / CANCELLED  — NOT implemented (later phase)
```

- `INITIAL_RIDE_REQUEST_STATUS = PENDING` — matches the `RideRequestStatus`
  enum default and the Phase 2 `@default(PENDING)` column default.
- `resolvedAt` stays `NULL` on creation (set on ACCEPT/REJECT/CANCEL later).

## 4. Duplicate active request — application check + DB constraint

`domain-model.md`/lifecycle define one active request per (ride, user).
Authoritative definition = the Phase 2 partial unique index:

```sql
CREATE UNIQUE INDEX "RideRequest_active_unique"
  ON "RideRequest"("rideId", "userId")
  WHERE "status" IN ('PENDING', 'ACCEPTED');
```

Therefore "active" = exactly `{PENDING, ACCEPTED}` (`ACTIVE_REQUEST_STATUSES`).
REJECTED/CANCELLED requests are historical and do **not** block a new request.

Two layers of protection, as designed:

1. **Application** — `findActiveRideRequest` pre-checks inside the same
   transaction before inserting (`ConflictError`).
2. **Database** — the partial unique index is the final arbiter of races; a
   `P2002` on a concurrent insert is translated to `ConflictError` (see §7).

The integration test "rejects a duplicate active request and the DB
constraint remains effective" proves both: the app-level rejection and a
direct raw insert failing on `RideRequest_active_unique`.

## 5. Self-request rule

A ride creator cannot request their own ride (`ride-engine.md` §4.7
"participant ≠ creator"). Enforced in the application layer — the database
does not (and should not) know the creator through the request row alone.

## 6. Seat validation

- `requestedSeats` is a positive integer (≥ 1), default 1
  (`domain-model.md` §2.3; DB CHECK `RideRequest_requestedSeats_positive`).
- Invalid values are a `ValidationError` (input shape).
- `requestedSeats > availableSeats` is a `BusinessRuleError` (a live
  availability fact, not an input-shape problem). Equal-to-available is
  allowed (inclusive boundary).
- **No reservation and no mutation**: request creation is read-only toward
  Ride/Participant data. Verified by the integration test "leaves Ride and
  Participant data intact".

## 7. Error model (reused from lib/errors.ts)

| Condition                                    | Error                                                        |
| -------------------------------------------- | ------------------------------------------------------------ |
| Malformed input (empty ids, bad seats)       | `ValidationError` (400)                                      |
| Missing requester / ride (or P2003 race)     | `NotFoundError` (404)                                        |
| Self-request / non-requestable state / seats | `BusinessRuleError` (422)                                    |
| Duplicate active request (or P2002 race)     | `ConflictError` (409)                                        |
| Anything else                                | `InternalError` (500), wrapping the cause — never leaked raw |

Every error carries a `field` and structured `details` for a future API layer.

## 8. Time-window deferral (OD-002)

`ride-engine.md` §4.7 lists "request window not expired" as a request
validation. Expiration/grace windows are **OD-002 (OPEN)** — the phase
instruction forbids inventing business rules and product decisions. No
time-based cutoff is implemented or hard-coded; requestability is decided
purely by ride status and seats. Recorded as an assumption/limitation.

## 9. Atomicity and the concurrency guarantee

The whole flow (requester lookup → ride + seats → rules → duplicate check →
insert) runs inside a **single `prisma.$transaction`**:

- no partial request data if any rule fails;
- a consistent snapshot for the seat/duplicate reads.

Because the reads and the insert share one transaction and the partial unique
index guards the write, two **concurrent** `createRideRequest` calls for the
same (ride, user) yield exactly one success and one `ConflictError` — proven
by the `Promise.allSettled` integration test.

## 10. Architecture and separation of concerns

```
create-ride-request.ts (application use case — Phase 3.5)
  ├─ assertValidRequestInput            (shape only)
  ├─ runTransaction (injectable port)   → default = prisma.$transaction
  │    └─ RideRequestPersistence port (Prisma-free)
  │         ├─ findRequester            → {id, name} | null
  │         ├─ findRideForRequest       → ride + live availableSeats (raw SQL)
  │         ├─ findActiveRequest        → active duplicate (PENDING/ACCEPTED)
  │         ├─ createRequest            → PersistedRideRequest
  │         └─ classifyError            → P2002 → 'unique', P2003 → 'foreign_key'
  └─ domain rules (domain/request-rules.ts, pure):
       REQUESTABLE_RIDE_STATUSES · ACTIVE_REQUEST_STATUSES ·
       MIN_REQUESTED_SEATS · isValidRequestedSeats ·
       isRequestableRideStatus · hasSufficientSeats
```

- All persistence/Prisma details stay in `infrastructure/ride.repository.ts`
  (each op takes `Prisma.TransactionClient`). The application layer depends
  only on the Prisma-free `RideRequestPersistence` shape, keeping
  `create-ride-request.ts` unit-testable without PostgreSQL.
- No HTTP, Express, controllers, routes, auth, or notifications.
- **No schema change**: the Phase 2 `RideRequest` model and its partial unique
  index / CHECK constraints already cover everything this phase needs.

## 11. Testing

- **Unit** (`domain/request-rules.test.ts`, `application/create-ride-request.test.ts`,
  no DB): seat bounds, requestable states, seat sufficiency, active-status
  constants, happy-path result mapping, requestedSeats default/passthrough,
  missing requester/ride, self-request, non-requestable states, seat rules,
  duplicate pre-check, historical-then-new allowed, input validation before
  any persistence, and error translation (AppError passthrough, P2002 →
  ConflictError, P2003 → NotFoundError, unexpected → InternalError).
- **Integration** (`infrastructure/request.integration.test.ts`, real DB):
  persistence + relationships + initial PENDING status, missing entities,
  self-request, non-requestable states, seats with a live CONFIRMED
  participant, duplicate rejection + raw DB constraint + `classifyError`,
  new request after a historical REJECTED one, FK classification, read-only
  behaviour toward Ride/Participant, and the concurrent duplicate race
  (one success + one ConflictError).

## 12. Open decisions left untouched

OD-002 (request expiration/grace window) — deliberately deferred, see §8.
OD-004, OD-007, and all other OD-001…OD-019 items remain open.

## 13. Assumptions

- "Active request" = exactly the statuses the Phase 2 partial unique index
  treats as exclusive ({PENDING, ACCEPTED}); REJECTED/CANCELLED are
  historical.
- Requestability is determined purely by ride status and seats; no time
  window (OD-002).
- `requestedSeats` defaults to 1 (domain-model.md §2.3).
- The creator ↔ ride ownership check uses `Ride.creatorId` (the stored
  creator), not any runtime/auth identity (authentication is a later phase).

## 14. Limitations

- No accept/reject, no participant creation, no seat reservation (Phase 3.6).
- No expiration/grace window on requests (OD-002, by design).
- No retry/cancellation flows beyond what the partial index implies
  (REJECTED/CANCELLED free the slot for a new request).
- No API surface: `requesterId` is a trusted application input today.
