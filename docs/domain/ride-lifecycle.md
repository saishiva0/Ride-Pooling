# RidePool — Ride Lifecycle (State Machine)

> Status: Phase 0 — Domain Definition
> This is the authoritative state machine for rides.

## 1. State Review

Proposed initial states: `DRAFT`, `PUBLISHED`, `REQUESTED`, `CONFIRMED`,
`IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `EXPIRED`.

**Review conclusion:** `REQUESTED` is **removed** as a ride state.

Rationale: "requested" describes the presence of join requests, which are
already tracked on the `RideRequest` entity. A ride does not change state when a
request is submitted; it simply receives a new `RideRequest`. Keeping
`REQUESTED` as a ride state adds a redundant, ambiguous state with no distinct
invariants or side effects.

**Final states (7):**

```
DRAFT
PUBLISHED
CONFIRMED
IN_PROGRESS
COMPLETED
CANCELLED
EXPIRED
```

## 2. State Descriptions

### 2.1 DRAFT

- **Purpose:** Creator is building the ride; not discoverable.
- **Entry conditions:** Ride created.
- **Allowed transitions:** → `PUBLISHED` (creator publishes); → `CANCELLED`
  (creator discards).
- **Forbidden transitions:** → `CONFIRMED` / `IN_PROGRESS` / `COMPLETED` /
  `EXPIRED` directly.
- **Actor:** Creator.
- **Side effects:** none (no visibility, no notifications).
- **Audit:** `RIDE_CREATED` event; `RideStatusHistory` row.

### 2.2 PUBLISHED

- **Purpose:** Ride is discoverable and open to join requests.
- **Entry conditions:** Creator publishes a `DRAFT` ride.
- **Allowed transitions:**
  - → `CONFIRMED` (first request accepted)
  - → `IN_PROGRESS` (creator starts ride; can start with or without
    participants)
  - → `CANCELLED` (creator cancels)
  - → `EXPIRED` (departure datetime passed without start; rule in §5)
- **Forbidden transitions:** → `DRAFT`, → `COMPLETED`.
- **Actor:** Creator (or system for expiration).
- **Side effects:** becomes discoverable; new requests allowed.
- **Notifications:** `RIDE_PUBLISHED` (informational).
- **Audit:** `RIDE_PUBLISHED` event; history row.

### 2.3 CONFIRMED

- **Purpose:** At least one participant has been accepted; the ride has
  confirmed participants.
- **Entry conditions:** Creator accepts the first request for a `PUBLISHED`
  ride.
- **Allowed transitions:**
  - → `IN_PROGRESS` (creator starts)
  - → `CANCELLED` (creator cancels)
  - → `PUBLISHED` (reverts if the last confirmed participant cancels and no
    others remain — see §4 Cancellation)
- **Forbidden transitions:** → `DRAFT`, → `EXPIRED`, → `COMPLETED` directly.
- **Actor:** Creator (start/cancel), participant (via cancellation).
- **Side effects:** seats allocated to confirmed participants; further requests
  still allowed while seats remain.
- **Notifications:** `RIDE_CONFIRMED` to creator + confirmed participants.
- **Audit:** `RIDE_CONFIRMED` event; history row.

### 2.4 IN_PROGRESS

- **Purpose:** The ride is underway.
- **Entry conditions:** Creator starts a `PUBLISHED` or `CONFIRMED` ride.
- **Allowed transitions:**
  - → `COMPLETED` (creator completes)
  - → `CANCELLED` (creator cancels; exceptional mid-ride cancellation)
- **Forbidden transitions:** → `PUBLISHED` / `CONFIRMED` / `EXPIRED` / `DRAFT`.
- **Actor:** Creator.
- **Side effects:** no new requests accepted.
- **Notifications:** `RIDE_STARTED`.
- **Audit:** `RIDE_STARTED` event; history row.

### 2.5 COMPLETED

- **Purpose:** Journey finished; appears in history.
- **Entry conditions:** Creator marks an `IN_PROGRESS` ride complete.
- **Allowed transitions:** none (terminal).
- **Forbidden transitions:** any.
- **Actor:** Creator.
- **Side effects:** history availability for creator + confirmed participants.
- **Notifications:** `RIDE_COMPLETED`.
- **Audit:** `RIDE_COMPLETED` event; history row.

### 2.6 CANCELLED

- **Purpose:** Ride cancelled before or during journey.
- **Entry conditions:** Creator cancels from `DRAFT`/`PUBLISHED`/`CONFIRMED`/
  `IN_PROGRESS`.
- **Allowed transitions:** none (terminal).
- **Forbidden transitions:** any.
- **Actor:** Creator (participant cancellation does not cancel the ride; see §4).
- **Side effects:** requests cancelled, seats released, affected users notified.
- **Notifications:** `RIDE_CANCELLED`.
- **Audit:** `RIDE_CANCELLED` event; history row.

### 2.7 EXPIRED

- **Purpose:** Published ride's departure time passed without starting.
- **Entry conditions:** `PUBLISHED` ride whose departure datetime has passed
  (rules in §5).
- **Allowed transitions:** none (terminal).
- **Forbidden transitions:** any.
- **Actor:** System (scheduled job / lazy evaluation).
- **Side effects:** pending requests marked `CANCELLED`; no new requests.
- **Notifications:** `RIDE_EXPIRED` (informational).
- **Audit:** `RIDE_EXPIRED` event; history row.

## 3. Transition Diagram

```
 DRAFT ──publish──▶ PUBLISHED ──first accept──▶ CONFIRMED ──start──▶ IN_PROGRESS ──complete──▶ COMPLETED
   │                   │  │                        │                  │
   │                   │  └──start──▶              │                  └──cancel──▶ CANCELLED
   │                   │      IN_PROGRESS          │
   │                   ├──cancel──▶ CANCELLED      ├──last participant cancels──▶ PUBLISHED
   │                   └──expire──▶ EXPIRED        └──cancel──▶ CANCELLED
   └──cancel──▶ CANCELLED
```

## 4. Cancellation Paths

### 4.1 Creator cancels ride

- Allowed from `DRAFT`, `PUBLISHED`, `CONFIRMED`, `IN_PROGRESS` (IN_PROGRESS
  cancellation is exceptional; requires confirmation in UI).
- Effects: ride → `CANCELLED`; all `PENDING`/`ACCEPTED` requests →
  `CANCELLED`; seats released; all affected users notified; history recorded.

### 4.2 Participant cancels

- `PENDING` request → participant may withdraw → request `CANCELLED`. Ride
  state unchanged.
- `ACCEPTED` participation → participant cancels participation → seat freed;
  request → `CANCELLED`. If the last confirmed participant cancels, the ride
  reverts `CONFIRMED → PUBLISHED` (still open to new requests). If ride is
  `IN_PROGRESS`, participation cancellation is not permitted (must coordinate;
  see OD-011).

### 4.3 Cancellation rules

- V1: no monetary penalties (no payments). Frequency-based abuse handling is
  future work (safety module).
- Exact per-state cancellation windows/grace periods = **PRODUCT DECISION
  REQUIRED** (OD-002).

## 5. Expiration Rules

- Candidate: `PUBLISHED` rides are eligible for `EXPIRED` when
  `now > departure_datetime + grace_window` AND ride has not started.
- `CONFIRMED` rides are **not** auto-expired by time (they wait for the
  creator to start; see OD-002).
- Exact grace window and lazy vs. scheduled evaluation = **PRODUCT DECISION
  REQUIRED**.

## 6. Request State Machine (complementary)

`RideRequest` states are separate from ride states:

```
PENDING ──creator accepts──▶ ACCEPTED
PENDING ──creator rejects──▶ REJECTED
PENDING ──participant withdraws──▶ CANCELLED
ACCEPTED ──participant cancels──▶ CANCELLED
PENDING/ACCEPTED ──ride cancelled/expired──▶ CANCELLED
```

`ACCEPTED` requests create a `RideParticipant` (status `CONFIRMED`) for the
ride.

## 7. Determinism & Guards

- Every transition has exactly one guard function (validator).
- Illegal transitions are rejected with a **business rule violation** error.
- State transitions + seat allocation are applied in a single transaction.

## 8. Document Map

| Related doc                        | Purpose                                           |
| ---------------------------------- | ------------------------------------------------- |
| `docs/domain/ride-engine.md`       | Engine spec + invariants                          |
| `docs/domain/domain-model.md`      | Entities incl. `RideStatusHistory`, `RideRequest` |
| `docs/architecture/event-model.md` | Events aligned to transitions                     |
| `docs/planning/open-decisions.md`  | OD-002 expiration/grace rules                     |
