# RidePool — Ride Engine Specification

> Status: Phase 0 — Domain Definition (specification only; no code)
> Owner: Systems Architect / Tech Lead

## 1. Purpose

The **Ride Engine** is the central business domain of RidePool. It owns the
complete ride lifecycle, ride discovery, matching, requests, seat management,
pricing calculation, and ride history. Everything else (auth, notifications,
UI, maps, payments) integrates with the Ride Engine.

## 2. Responsibilities

The Ride Engine is responsible for:

- Ride creation
- Ride validation
- Ride publication
- Ride discovery
- Ride details
- Ride matching
- Ride requests
- Request acceptance / rejection
- Seat availability
- Pricing calculation
- Ride state transitions
- Ride cancellation
- Ride expiration
- Ride start
- Ride completion
- Ride history

## 3. Non-Responsibilities

The Ride Engine does **not** own:

- Authentication infrastructure
- Push notification infrastructure
- Mobile UI
- Map rendering
- Payment processing
- Admin dashboard
- Analytics infrastructure

These systems will integrate with the Ride Engine later.

## 4. Submodules

### 4.1 Ride Creation

Inputs: pickup, destination, date, time, seats, vehicle type (optional), radius
(optional), pricing. Validation: route validity, future departure, seats ≥ 1,
price within configured range. Output: ride in `DRAFT`.

### 4.2 Ride Validation

- Required fields present and valid.
- Departure datetime is in the future (with grace window; OD-002).
- Seats within allowed bounds (≥ 1, ≤ configured max).
- Pricing type valid; custom price within range.
- Pickup ≠ destination (or sensible minimum distance).

### 4.3 Ride Publication

Transitions `DRAFT → PUBLISHED`. Ride becomes discoverable.

### 4.4 Ride Discovery

Nearby rides via radius filtering, time filtering, destination relevance, seat
availability, price visibility, and status filtering. See
`docs/domain/matching-model.md`.

### 4.5 Ride Details

Route information, creator information, departure information, seats, distance,
price/km, estimated contribution, status.

### 4.6 Ride Matching

Deterministic factors (in priority order):

1. Pickup proximity
2. Destination compatibility
3. Time compatibility
4. Seat availability
5. Ride status

No AI matching in V1. See `docs/domain/matching-model.md`.

### 4.7 Ride Requests

- Create request (`PENDING`).
- Validate: ride active, seats available, no duplicate active request,
  participant ≠ creator, request window not expired.
- Track state: `PENDING` → `ACCEPTED` / `REJECTED` / `CANCELLED`.
- Accept / reject performed by creator only.
- Cancel where permitted (participant withdraw of `PENDING`).

### 4.8 Seat Management

- Available seats = total seats − confirmed participants (and held reservations
  if introduced later).
- Prevent overbooking: seat allocation is transactional on acceptance.
- Restore availability when a confirmed participant cancels.
- Requested-but-not-yet-accepted seats do **not** reduce availability in V1
  (see `docs/domain/ride-engine.md` invariants + concurrency notes).

### 4.9 Ride Lifecycle

Formal state machine — see `docs/domain/ride-lifecycle.md`.

### 4.10 Cancellation

- Creator cancellation: allowed per rules (see lifecycle).
- Participant cancellation: frees seat, updates request/history.
- Notifications to affected users.
- Recorded in `RideStatusHistory` / request history.

### 4.11 Expiration

- `PUBLISHED` rides whose departure datetime passes without being started may
  be marked `EXPIRED` (rules in lifecycle doc; OD-002).

### 4.12 Completion

- Creator marks ride complete → `COMPLETED`.
- Ride available in creator's and confirmed participants' history.

### 4.13 History

- Every ride state transition recorded (`RideStatusHistory`).
- Every request transition recorded.
- Audit/history for events: see `docs/architecture/event-model.md`.

## 5. Ride Engine Invariants

1. Available seats never negative.
2. Confirmed participants never exceed total seats.
3. `COMPLETED` ride cannot return to a prior state.
4. `CANCELLED` / `EXPIRED` rides accept no new requests.
5. Duplicate active requests prevented (one per participant per ride).
6. Invalid state transitions rejected.
7. Price per km always within configured limits.
8. Only the ride creator may modify/cancel/publish/start/complete their ride.
9. Participants cannot join unavailable rides.
10. A user cannot request their own ride.
11. Estimated contribution is non-negative and derived from distance × price/km.
12. Request acceptance only when seats available (atomic check + allocate).

## 6. Concurrency Risks

- **Last-seat race:** two participants request the last available seat
  simultaneously; both accepted → overbooking. **Seat allocation must be
  transactionally safe** (row lock / conditional update).
- **Same-seat double accept:** creator accepts two pending requests when only
  one seat remains.
- **Concurrent state transitions:** two requests to start/cancel/complete the
  same ride concurrently → must serialize via transaction.
- **Duplicate request race:** two identical requests created near-simultaneously
  → unique constraint on (participant, ride, active request).

## 7. Events

Ride Engine emits domain events. Full list: `docs/architecture/event-model.md`.

`RIDE_CREATED`, `RIDE_PUBLISHED`, `RIDE_UPDATED`, `RIDE_REQUESTED`,
`REQUEST_ACCEPTED`, `REQUEST_REJECTED`, `REQUEST_CANCELLED`, `RIDE_CONFIRMED`,
`RIDE_STARTED`, `RIDE_CANCELLED`, `RIDE_COMPLETED`, `RIDE_EXPIRED`.

## 8. Error Conditions

Standard error categories and Ride Engine examples:
`docs/architecture/api-boundaries.md` § Error Model.

## 9. Testing Requirements (Future)

- Unit tests: pricing calculation, state transitions, request validation,
  matching rules.
- Integration tests: transactional seat allocation, cancellation effects,
  event emission.
- API tests: ride CRUD, request flows, error codes.
- Concurrency tests: last-seat race, double-accept race.
- Property-based checks on invariants.

## 10. Document Map

| Related doc                           | Purpose                  |
| ------------------------------------- | ------------------------ |
| `docs/domain/ride-lifecycle.md`       | State machine            |
| `docs/domain/pricing-model.md`        | Pricing rules            |
| `docs/domain/matching-model.md`       | Discovery + matching     |
| `docs/domain/domain-model.md`         | Entities & relationships |
| `docs/architecture/api-boundaries.md` | API + errors             |
| `docs/architecture/event-model.md`    | Events + observability   |
