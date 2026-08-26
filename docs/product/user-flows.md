# RidePool — User Flows

> Status: Phase 0 — Product Definition
> Superset of journeys; exact screens/navigation in
> `docs/architecture/system-architecture.md` and `docs/product/v1-scope.md`.

## 1. Primary Flow — Creator Publishes & Participants Join

```
User (Creator)
  ↓
Creates Ride
  ↓
Enters Pickup
  ↓
Enters Destination
  ↓
Selects Date/Time
  ↓
Selects Available Seats
  ↓
Selects Pricing (Standard / Custom)
  ↓
Publishes Ride
  ↓
Nearby users discover ride
  ↓
Potential participant views ride
  ↓
Participant requests to join
  ↓
Creator reviews request
  ↓
Creator accepts / rejects
  ↓
If accepted → Ride becomes CONFIRMED
  ↓
Ride starts → IN_PROGRESS
  ↓
Ride completes → COMPLETED
  ↓
Ride appears in history
```

## 2. Secondary Flow — Participant Rejected

```
Participant
  ↓
Discovers ride
  ↓
Requests to join
  ↓
Creator rejects
  ↓
Participant remains available for other rides
```

## 3. Cancellation Flow

```
Creator / Participant
  ↓
Cancellation request
  ↓
Validate cancellation rules
  ↓
Update ride / request state
  ↓
Notify affected users
  ↓
Record history
```

## 4. Detailed Step Requirements

### 4.1 Create a Ride (Creator)

- Required inputs: pickup location, destination, departure date, departure time,
  available seats, pricing selection.
- Optional inputs: vehicle type, search/discovery radius.
- Validation: route validity, future departure, seats ≥ 1, price within range.
- Output: ride in `DRAFT` state, editable until published.

### 4.2 Publish (Creator)

- Moves ride `DRAFT → PUBLISHED`.
- Ride becomes discoverable to eligible participants.

### 4.3 Discover (Participant)

- Uses participant's location (or chosen pickup), radius, time window,
  destination relevance, seat availability, and ride status to list rides.
- See `docs/domain/matching-model.md` for the discovery pipeline.

### 4.4 View Ride Details (Participant)

- Route info, creator info, departure info, seats, distance, price/km,
  estimated contribution, and status.
- Contribution is visible **before** requesting.

### 4.5 Request to Join (Participant)

- Creates a `RideRequest` in `PENDING` state.
- Duplicate active requests prevented.
- Seat is not reserved at request time (allocation happens on acceptance).

### 4.6 Accept / Reject (Creator)

- Accept → request becomes `ACCEPTED`, participant joins the ride
  (`RideParticipant` with status `CONFIRMED`), seat allocated transactionally.
- Reject → request becomes `REJECTED`, participant notified.

### 4.7 Start (Creator)

- Ride moves to `IN_PROGRESS` (only from `PUBLISHED` or `CONFIRMED`).

### 4.8 Complete (Creator)

- Ride moves to `COMPLETED`. Available to creator and confirmed participants.

### 4.9 Cancel (Creator)

- Allowed per cancellation rules. Affected participants notified. Request
  states updated to `CANCELLED`.

### 4.10 Cancel (Participant)

- A `PENDING` request can be withdrawn by the participant.
- An `ACCEPTED` participation can be cancelled; seats are freed per rules.

## 5. Cross-Cutting Flows

- **Notifications:** ride request, accepted, rejected, reminder, cancellation,
  and state changes.
- **Real-time:** request/ride state changes pushed to connected clients.
- **Communication:** no ride chat in V1; ride chat is deferred to V1.1 (OD-009).
- **History:** every ride and request state change recorded in
  `RideStatusHistory` / request history.

## 6. Flow ↔ Document Map

| Flow                     | Primary spec                    |
| ------------------------ | ------------------------------- |
| Ride creation            | `docs/domain/ride-engine.md`    |
| Discovery / matching     | `docs/domain/matching-model.md` |
| Requests / seats         | `docs/domain/ride-engine.md`    |
| Lifecycle / cancellation | `docs/domain/ride-lifecycle.md` |
| Pricing                  | `docs/domain/pricing-model.md`  |
| Entities                 | `docs/domain/domain-model.md`   |
