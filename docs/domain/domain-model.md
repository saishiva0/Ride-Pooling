# RidePool — Domain Model

> Status: Phase 0 — Domain Definition
> Conceptual entities and relationships. **No database schema.**

## 1. Purpose

Defines the core domain entities, their responsibilities, relationships, and
the location model. This guides the Ride Engine and future persistence layer.

## 2. Core Entities

### 2.1 User

- **Purpose:** A registered person on the platform (acts as Creator and/or
  Participant).
- **Responsibilities:** Identity, profile, preferences, auth sessions.
- **Relationships:** creates `Ride`; submits `RideRequest`; participates in
  `Ride` via `RideParticipant`.
- **Important fields (conceptual):** id, name, phone/email, password/token
  (method = OD-005), profile data, verification fields (OD-010), createdAt.
- **Required for V1:** ✅ Yes.
- **Dependencies:** auth infrastructure (not Ride Engine).

### 2.2 Ride

- **Purpose:** A published journey with capacity to share.
- **Responsibilities:** Owns route, departure, seats, pricing, state, history.
- **Relationships:** belongs to Creator (User); has `RideRequest`(s); has
  `RideParticipant`(s); has `RideStatusHistory`; has Location(s).
- **Important fields (conceptual):** id, creatorId, pickupLocation,
  destinationLocation, departureDateTime, totalSeats, vehicleType (optional),
  discoveryRadius (optional), pricing fields (pricingType, pricePerKm,
  estimatedDistanceKm, estimatedContribution), status, timestamps.
- **Required for V1:** ✅ Yes.
- **Dependencies:** User, Location, pricing config.

### 2.3 RideRequest

- **Purpose:** A participant's request to join a ride.
- **Responsibilities:** Track request lifecycle (`PENDING` → `ACCEPTED` /
  `REJECTED` / `CANCELLED`).
- **Relationships:** belongs to User; targets Ride.
- **Important fields (conceptual):** id, rideId, userId, requestedSeats (≥1;
  default 1), status, createdAt, resolvedAt.
- **Required for V1:** ✅ Yes.
- **Dependencies:** User, Ride.

### 2.4 RideParticipant

- **Purpose:** A participant confirmed on a ride (result of an accepted
  request).
- **Responsibilities:** Track confirmed membership and seat allocation.
- **Relationships:** belongs to Ride; references User.
- **Important fields (conceptual):** id, rideId, userId, requestId, seats
  allocated, status (`CONFIRMED` / `CANCELLED`), joinedAt, cancelledAt.
- **Required for V1:** ✅ Yes.
- **Dependencies:** Ride, RideRequest, User.

### 2.5 RideStatusHistory

- **Purpose:** Append-only audit of ride state transitions.
- **Responsibilities:** Record every ride state change (who, when, from, to,
  reason).
- **Relationships:** belongs to Ride.
- **Important fields (conceptual):** id, rideId, fromStatus, toStatus,
  changedByUserId, reason, createdAt.
- **Required for V1:** ✅ Yes (audit + history).
- **Dependencies:** Ride.

### 2.6 Location (value object / embedded)

- **Purpose:** Geographic coordinates for pickup, destination, and current
  location.
- **Responsibilities:** Hold lat/lng (+ optional label); support distance
  computation.
- **Relationships:** embedded on Ride (pickup, destination) and on User current
  location (transient).
- **Important fields (conceptual):** latitude, longitude, label (optional).
- **Required for V1:** ✅ Yes (embedded).
- **Dependencies:** none.

### 2.7 Notification

- **Purpose:** Record of a notification sent to a user.
- **Responsibilities:** Track notification type, channel, read state.
- **Relationships:** belongs to User; references Ride/RideRequest context.
- **Important fields (conceptual):** id, userId, type, payload, readAt, createdAt.
- **Required for V1:** ✅ Yes (in-app at minimum).
- **Dependencies:** User, event model.

## 3. Future Entities (not V1)

| Entity     | Purpose                                                | V1?                   |
| ---------- | ------------------------------------------------------ | --------------------- |
| `Message`  | Ride-specific chat (deferred to V1.1; OD-009 resolved) | ❌                    |
| `Report`   | User/ride reporting for safety                         | 🔶 Baseline only      |
| `Device`   | Push token / device registration                       | 🔶 With push (OD-008) |
| `Admin`    | Admin staff identity                                   | ❌                    |
| `AuditLog` | Broad system audit beyond ride history                 | ❌                    |

## 4. Relationships

```
User
 ├── creates → Ride
 ├── submits → RideRequest
 └── participates in → Ride (via RideParticipant)

Ride
 ├── belongs to → Creator (User)
 ├── has → RideRequest (many)
 ├── has → RideParticipant (many, confirmed)
 ├── has → RideStatusHistory (many, append-only)
 ├── has → pickup Location
 └── has → destination Location

RideRequest
 ├── belongs to → User
 └── targets → Ride
   └── (accepted) → produces → RideParticipant

RideParticipant
 ├── belongs to → Ride
 ├── references → User
 └── references → originating RideRequest
```

### Review of proposed relationships

- **Missing (identified):** `RideParticipant → RideRequest` (trace origin of a
  confirmed seat), `RideStatusHistory → Ride` (already present), `Notification →
Ride/RideRequest` context references.
- **Unnecessary:** none proposed were removed, but `Location` is treated as a
  value object embedded on Ride/User rather than a standalone aggregate.
- **Not modelled as entities:** User "current location" is transient; not a
  persistent entity.

## 5. Location Model

### 5.1 Separation of concerns

- **User Location:** the participant's current location (or chosen pickup
  point) used for discovery. Transient; permission-gated; not continuously
  tracked.
- **Ride Location:** pickup and destination of a ride (lat/lng). Persistent
  domain data owned by the Ride.

### 5.2 Requirements

- Latitude / longitude for pickup, destination, and user current location.
- Search radius for discovery.
- Distance calculation (straight-line vs. route; OD-007).
- Route compatibility (for destination tolerance; OD-004).
- Geospatial indexing for nearby queries (PostGIS candidate).

### 5.3 Privacy & permissions

- Location permission requested at time of need (discovery), not continuously.
- No background location tracking assumption.
- User current location is ephemeral and not persisted as a user record.
- Ride pickup/destination are published ride data (already user-consented).
- See `docs/planning/legal-regulatory-note.md` for location data review items.

## 6. Document Map

| Related doc                           | Purpose                                |
| ------------------------------------- | -------------------------------------- |
| `docs/domain/ride-engine.md`          | Engine ownership of entities           |
| `docs/domain/ride-lifecycle.md`       | States recorded in `RideStatusHistory` |
| `docs/domain/matching-model.md`       | Location used for discovery            |
| `docs/architecture/api-boundaries.md` | Resource-oriented API mapping          |
| `docs/architecture/event-model.md`    | Events referencing entities            |
