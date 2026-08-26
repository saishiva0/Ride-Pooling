# RidePool — API Boundaries & Error Model

> Status: Phase 0 — Architecture Planning
> Conceptual API boundaries only. **No routes are implemented in Phase 0.**

## 1. Purpose

Defines resource-oriented API boundaries and the standard error model used
across the API. The final endpoint structure will be refined during
implementation.

## 2. API Boundary Groups

| Group         | Boundary                           | Notes                                                                    |
| ------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| Health        | `/health`                          | Liveness/readiness                                                       |
| Auth          | `/api/v1/auth/*`                   | Register, login, logout, refresh                                         |
| Users         | `/api/v1/users/*`                  | Profile, preferences, account                                            |
| Rides         | `/api/v1/rides/*`                  | Create, publish, update, cancel, start, complete, list, discover, detail |
| Requests      | `/api/v1/rides/:rideId/requests/*` | Request to join, list, accept, reject, cancel                            |
| Notifications | `/api/v1/notifications/*`          | List, mark read                                                          |
| Location      | `/api/v1/location/*`               | Reverse-geocode / distance proxy (V1.1 candidate)                        |
| Real-time     | `/ws` (WebSocket)                  | Ride/request state pushes                                                |

No Chat/Communication API group is part of V1; ride chat is deferred to V1.1
(OD-009 resolved).

### Mapping to modules

- `auth/*` → User & Authentication
- `users/*` → User & Authentication
- `rides/*`, `rides/:id/requests/*` → Ride Engine
- `notifications/*` → Notifications
- `/ws` → Real-time

## 3. Request / Response Conventions (conceptual)

- REST over HTTPS; JSON bodies.
- Versioned namespace `/api/v1`.
- Pagination for list endpoints (cursor or offset — implementation decision).
- Idempotency keys for request-creation to prevent duplicate requests (with
  domain-level duplicate prevention).
- Auth via bearer token (OD-005).

## 4. Error Model

### 4.1 Categories

| Category                 | HTTP (conceptual) | Description                                                          |
| ------------------------ | ----------------- | -------------------------------------------------------------------- |
| Validation error         | 400               | Input violates validation rules                                      |
| Authentication error     | 401               | Missing/invalid credentials/token                                    |
| Authorization error      | 403               | Authenticated but not permitted                                      |
| Resource not found       | 404               | Resource does not exist                                              |
| Conflict                 | 409               | State conflict (e.g., duplicate request)                             |
| Business rule violation  | 422               | Domain rule violation (state transition illegal, price out of range) |
| Rate limit               | 429               | Too many requests                                                    |
| External service failure | 502/503           | Maps, push, etc. unavailable                                         |
| Internal server error    | 500               | Unexpected failure                                                   |

### 4.2 Ride Engine Error Examples

| Operation      | Error category                | Example                                                 |
| -------------- | ----------------------------- | ------------------------------------------------------- |
| Create ride    | Validation                    | departure in past, seats = 0, custom price out of range |
| Publish        | Business rule                 | ride already published                                  |
| Request join   | Conflict / Business rule      | duplicate active request; ride not active; no seats     |
| Accept request | Business rule / Conflict      | overbooking (no seat left); request not `PENDING`       |
| Start ride     | Business rule                 | illegal transition from `COMPLETED`                     |
| Cancel ride    | Authorization / Business rule | non-creator tries to cancel; ride terminal              |
| Complete ride  | Business rule                 | not in `IN_PROGRESS`                                    |
| Modify ride    | Authorization                 | creator-only                                            |

### 4.3 Error Response Shape (conceptual)

```json
{
  "error": {
    "code": "BUSINESS_RULE_VIOLATION",
    "message": "Ride cannot accept new requests in state CANCELLED",
    "field": "rideId",
    "details": {}
  }
}
```

## 5. Document Map

| Related doc                | Purpose                         |
| -------------------------- | ------------------------------- |
| `module-boundaries.md`     | Module ownership of endpoints   |
| `event-model.md`           | Events triggered by endpoints   |
| `system-architecture.md`   | API layer context               |
| `../domain/ride-engine.md` | Engine invariants behind errors |
