# RidePool — Event Model & Observability

> Status: Phase 0 — Architecture Planning
> Domain events and observability. **No event bus is implemented in Phase 0.**

## 1. Purpose

Defines future domain events and the observability baseline. Events will drive
real-time updates, notifications, analytics, and audit history.

## 2. Domain Events

### 2.1 Event Catalogue

| Event               | Trigger                         | Source module | Consumers                                            |
| ------------------- | ------------------------------- | ------------- | ---------------------------------------------------- |
| `RIDE_CREATED`      | Ride created (DRAFT)            | Ride Engine   | Analytics, Audit                                     |
| `RIDE_PUBLISHED`    | DRAFT → PUBLISHED               | Ride Engine   | Discovery index, Real-time, Notifications, Analytics |
| `RIDE_UPDATED`      | Ride edited                     | Ride Engine   | Real-time, Analytics                                 |
| `RIDE_REQUESTED`    | Participant requests to join    | Ride Engine   | Notifications (creator), Real-time                   |
| `REQUEST_ACCEPTED`  | Creator accepts request         | Ride Engine   | Notifications (participant), Real-time, Analytics    |
| `REQUEST_REJECTED`  | Creator rejects request         | Ride Engine   | Notifications (participant), Real-time               |
| `REQUEST_CANCELLED` | Request/participation cancelled | Ride Engine   | Real-time, Notifications, Analytics                  |
| `RIDE_CONFIRMED`    | First request accepted          | Ride Engine   | Notifications, Real-time, Analytics                  |
| `RIDE_STARTED`      | Ride → IN_PROGRESS              | Ride Engine   | Notifications, Real-time                             |
| `RIDE_CANCELLED`    | Ride cancelled                  | Ride Engine   | Notifications, Real-time, Analytics                  |
| `RIDE_COMPLETED`    | Ride → COMPLETED                | Ride Engine   | Notifications, Real-time, Analytics, History         |
| `RIDE_EXPIRED`      | Ride expired                    | Ride Engine   | Notifications, Analytics                             |

No Chat events are defined in V1; ride chat is deferred to V1.1 (OD-009
resolved).

### 2.2 Important Payloads (conceptual)

- Identity: `rideId`, `requestId`, `participantId` where applicable.
- Transition payloads include `fromStatus`, `toStatus`, `changedByUserId`,
  `occurredAt`, and a stable event id.
- **Do not** include sensitive location coordinates or personal data beyond
  user/ride ids in events meant for analytics/audit logs.

### 2.3 Event Alignment with State Machine

Every state transition in `docs/domain/ride-lifecycle.md` emits exactly one
corresponding event:

```
DRAFT→PUBLISHED       RIDE_PUBLISHED
PUBLISHED→CONFIRMED   RIDE_CONFIRMED
PUBLISHED→IN_PROGRESS RIDE_STARTED
CONFIRMED→IN_PROGRESS RIDE_STARTED
IN_PROGRESS→COMPLETED RIDE_COMPLETED
PUBLISHED→CANCELLED   RIDE_CANCELLED
CONFIRMED→CANCELLED   RIDE_CANCELLED
IN_PROGRESS→CANCELLED RIDE_CANCELLED
PUBLISHED→EXPIRED     RIDE_EXPIRED
DRAFT→CANCELLED       RIDE_CANCELLED
CONFIRMED→PUBLISHED   (no dedicated ride event; revert driven by REQUEST_CANCELLED
                       when the last confirmed participant cancels)
```

## 3. Dispatch Model (V1)

- In-module function calls + an internal event dispatcher (in-process).
- No external message broker / event streaming in V1 (matches ADR-003/ADR-009).
- If a future scale-up needs it, an outbox pattern can be introduced later.

## 4. Observability

### 4.1 Important Events / Logs

- Ride created, published, updated
- Ride request created, accepted, rejected, cancelled
- Ride cancelled, started, completed, expired
- Matching performed (count of candidates evaluated)
- Pricing calculated (distance, price/km, contribution)

### 4.2 Logging Rules

- Structured logs (JSON) with correlation ids.
- **Do not** log sensitive location information unnecessarily.
- **Do not** expose personal information (names, phone numbers, exact pickup
  coordinates) in logs.
- Log business identifiers (rideId, requestId, userId) not PII.

### 4.3 Health Checks

- `/health` liveness; readiness covers DB connectivity and critical external
  integrations.
- Error tracking for unhandled exceptions (provider: OD-008-adjacent; review).

### 4.4 Metrics

Business metrics derived from events (see `docs/product/product-requirements.md`
§17): rides created/published/confirmed/completed, requests accepted/rejected,
cancellation rate, match success rate, completion ratio.

## 5. Document Map

| Related doc                          | Purpose                      |
| ------------------------------------ | ---------------------------- |
| `../domain/ride-lifecycle.md`        | Transitions that emit events |
| `../domain/ride-engine.md`           | Engine history requirements  |
| `system-architecture.md`             | Observability context        |
| `api-boundaries.md`                  | Endpoints triggering events  |
| `../product/product-requirements.md` | Success metrics              |
