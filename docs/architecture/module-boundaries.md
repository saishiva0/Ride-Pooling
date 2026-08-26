# RidePool — Module Boundaries & Dependency Graph

> Status: Phase 0 — Architecture Planning

## 1. Purpose

Defines the backend modules, their responsibilities, classification, and how
they depend on one another.

## 2. Module Dependency Graph

```
Product (vision, PRD, scope)
   ↓
Foundation (types, config, errors, logging, auth utilities)
   ↓
Database (PostgreSQL + Prisma access layer)
   ↓
RIDE ENGINE (core domain)
   ├── User
   ├── Location
   ├── Real-time
    ├── Notifications
    ├── Communication (V1.1)
    ├── Safety
   ├── Admin
   └── Analytics
```

The Ride Engine is the **central business domain**; all other modules either
serve it or consume its events.

## 3. Module Classification

| Module                | Class                          | V1?                           |
| --------------------- | ------------------------------ | ----------------------------- |
| Ride Engine           | **CORE**                       | ✅                            |
| User & Authentication | **CORE**                       | ✅                            |
| Location & Maps       | **CORE** (discovery, distance) | ✅                            |
| Database / Foundation | **CORE** (support)             | ✅                            |
| Real-time             | **SUPPORTING**                 | ✅                            |
| Notifications         | **SUPPORTING**                 | ✅                            |
| Safety & Trust        | **SUPPORTING**                 | ✅ baseline                   |
| Communication         | **FUTURE**                     | ❌ (deferred to V1.1; OD-009) |
| Admin                 | **FUTURE**                     | ❌                            |
| Analytics             | **FUTURE**                     | 🔶 observability only in V1   |

## 4. Module Responsibilities

### 4.1 Ride Engine (Core)

Owns ride creation, validation, publication, discovery, matching, requests,
seat management, pricing, lifecycle, cancellation, expiration, completion,
history. See `docs/domain/ride-engine.md`.

### 4.2 User & Authentication

Registration, login, auth, sessions/tokens, profile, preferences, account
management.

### 4.3 Location & Maps

Location permission, current location, map rendering, route visualization,
distance calculation, nearby discovery.

### 4.4 Real-time

Ride updates, request updates, state changes, real-time UI synchronization
(Socket.io/WebSocket).

### 4.5 Notifications

Ride request, accepted, rejected, reminder, cancellation, state-change
notifications.

### 4.6 Communication

Ride-specific communication, system messages, participant coordination. Not in
V1; deferred to V1.1 (OD-009 resolved). Detailed Chat requirements will be
defined in the V1.1 Chat planning phase.

### 4.7 Safety & Trust

Reporting, blocking, cancellation controls, user safety information, basic
verification, abuse prevention.

### 4.8 Admin

User moderation, ride moderation, reports, operational monitoring (future).

### 4.9 Analytics

Product, ride, matching, completion, retention metrics (observability in V1;
full analytics future).

## 5. Dependency Rules

- **Ride Engine depends only on:** Foundation (types/config), Database,
  domain events. It does **not** depend on UI, push, maps, or payments.
- **Modules depend on Ride Engine events** (notifications, real-time,
  analytics) — never the reverse.
- **Location module** provides distance/maps to discovery; Ride Engine defines
  the discovery contract.
- **Auth** is infrastructure used by API layer; Ride Engine assumes an
  authenticated user id.

## 6. Communication Pattern

In-module function calls within the monolith + an internal event dispatch for
side effects (notifications, real-time, analytics). No external message broker
in V1 (see `docs/architecture/event-model.md`).

## 7. Document Map

| Related doc                | Purpose                        |
| -------------------------- | ------------------------------ |
| `system-architecture.md`   | System diagram + infra         |
| `api-boundaries.md`        | API ownership per module       |
| `event-model.md`           | Events flowing between modules |
| `technical-decisions.md`   | ADR-003 modular monolith       |
| `../domain/ride-engine.md` | Engine spec                    |
