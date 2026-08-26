# RidePool — System Architecture

> Status: Phase 0 — Architecture Planning
> High-level architecture. No code. No infrastructure provisioning.

## 1. Overview

RidePool V1 is a **modular monolith**: a single deployable backend with clearly
separated modules, a PostgreSQL database, and a mobile-first client. The Ride
Engine is the central business domain.

## 2. High-Level Diagram

```
┌──────────────────────────────────────────────┐
│              Mobile App (RN/Expo)            │
│   Onboarding · Auth · Home · Discovery · ... │
└──────────────────────┬───────────────────────┘
                       │ HTTPS + WebSocket
                       ▼
┌──────────────────────────────────────────────┐
│              API (Node.js + TypeScript)      │
│   /api/v1/*  REST  +  /ws  real-time         │
├──────────────────────────────────────────────┤
│  auth │ users │ rides │ requests │           │
│  notifications │ location │ safety           │
├──────────────────────────────────────────────┤
│           RIDE ENGINE (core domain)          │
│  creation · validation · discovery · matching│
│  requests · seats · lifecycle · pricing      │
├──────────────────────────────────────────────┤
│              PostgreSQL (+ PostGIS)          │
└──────────────────────────────────────────────┘
```

## 3. Future Integrations

```
Ride Engine
 ├── Location / Maps (geocode, distance, maps) ── external provider (OD-007)
 ├── Notifications ── push provider (OD-008), in-app real-time
 ├── Real-time ── Socket.io / WebSocket
 ├── Communication ── ride chat (deferred to V1.1; OD-009 resolved)
 ├── Safety ── reporting, blocking, moderation hooks
 ├── Admin ── future dashboard
 └── Analytics ── metrics, future warehouse
```

## 4. Dependencies

- Mobile App → API (HTTPS, WS).
- API → all backend modules → Ride Engine → PostgreSQL.
- Ride Engine → config (pricing, thresholds), domain events.
- External integrations are invoked by modules but are **not** required for the
  Ride Engine's internal correctness.

## 5. Architecture Principles

1. Modular architecture — logical separation, single deployable.
2. Clear domain boundaries — modules communicate via explicit interfaces.
3. Strong typing — TypeScript across backend and shared contracts.
4. API-first backend — mobile client consumes REST + WS.
5. Mobile-first UX.
6. Configuration over hardcoding — pricing, thresholds, limits in config.
7. Testable business logic — Ride Engine has no I/O coupling.
8. Explicit state machines — ride and request lifecycle are declarative.
9. Transactional consistency — state changes + seat allocation atomic.
10. Minimal infrastructure — one backend, one database.
11. Avoid premature microservices.
12. Avoid unnecessary dependencies.
13. Prefer simple solutions.
14. Security by default.
15. Observability from the beginning.

## 6. Modular Monolith (V1)

Recommended: modular monolith. Logical modules (authoritative list in
`docs/architecture/module-boundaries.md`):

```
Ride Engine (core) · User & Authentication · Location & Maps ·
Real-time · Notifications · Safety & Trust · Communication (V1.1) ·
Database/Foundation
```

Deployed as one service. Horizontal scale later via multiple instances behind a
load balancer when needed. No Kubernetes, service mesh, or event streaming
platforms for the initial MVP.

## 7. Infrastructure Principles

### MVP infrastructure

- Single backend instance (container or simple VM).
- Managed PostgreSQL (or local Postgres for dev).
- Simple CI/CD (build → test → deploy).
- Low cost, low maintenance, easy local dev, easy debugging.

### Future-scale infrastructure

- Multiple backend instances, load balancer, managed DB scaling, object
  storage, dedicated monitoring — only when user growth justifies it.

Avoid unnecessary managed services in V1.

## 8. Cost Principles

- Prefer free/open-source tooling.
- Minimize paid APIs, infrastructure, SaaS, and operational complexity.

### Future variable-cost services to watch (COST / VENDOR REVIEW REQUIRED)

- Maps / geocoding / distance APIs
- Push notifications
- SMS/OTP
- Cloud hosting
- Managed database
- Object storage
- Monitoring/observability

No vendors are selected in this phase. See
`docs/planning/cost-vendor-review.md` and `docs/planning/open-decisions.md`
(OD-007, OD-008).

## 9. Non-Functional Requirements

### Performance

- Fast API responses (targets set during implementation; no invented numbers).
- Efficient database queries; indexed geospatial queries for discovery.
- Mobile-friendly payload sizes.

### Scalability

- Modular monolith can grow from small MVP to larger user base without a
  rewrite. Scale-out via instances, not architectural rewrite.

### Reliability

- Graceful failures; consistent ride states; transactional operations for seat
  allocation and state transitions.

### Security

- Secure authentication, input validation, authorization, data protection.
- Details in §11 and `docs/architecture/api-boundaries.md` (error model).

### Observability

- Structured logs, error tracking, health checks, business event metrics.
- See `docs/architecture/event-model.md`.

## 10. Mobile Application Architecture

### Screen groups

```
ONBOARDING · AUTHENTICATION · HOME · RIDE DISCOVERY · RIDE DETAILS ·
CREATE RIDE · RIDE REQUESTS · MY RIDES · ACTIVE RIDE · RIDE HISTORY ·
NOTIFICATIONS · PROFILE · SETTINGS
```

### Navigation relationships (conceptual)

```
Onboarding → Auth → Home
Home → Discovery → Ride Details → Request → My Rides
Home → Create Ride → Publish
My Rides → Active Ride → Complete / Cancel
My Rides → Ride History
Profile → Settings → Notifications
```

No screens are implemented in Phase 0.

## 11. Security Requirements (baseline)

- **Authentication:** secure login, session/token handling (OD-005).
- **Authorization:** creator-only actions on rides; participant-only on own
  requests.
- **Input validation:** all API inputs validated (Zod).
- **Rate limiting:** on auth, request creation, discovery.
- **Secure secrets:** env-based config, secret manager for production.
- **Secure API communication:** HTTPS/TLS everywhere.
- **Database access control:** least-privilege DB roles; no raw SQL injection.
- **Location privacy:** permission-gated; minimal collection; no continuous
  tracking.
- **Personal data protection:** minimal data collection; access control;
  retention rules (OD-013).
- **Logging:** no sensitive location or personal info in logs.
- **Abuse prevention:** duplicate prevention, rate limits, safety reporting.

## 12. Data Consistency & Concurrency

- Invariants enforced by the Ride Engine (see
  `docs/domain/ride-engine.md` §5).
- Seat allocation is **transactionally safe**; no overbooking under
  concurrency.
- See `docs/domain/ride-engine.md` §6 for race conditions and the mitigation
  approach (transactional row locks / conditional updates / unique constraints).

## 13. Document Map

| Related doc                         | Purpose                     |
| ----------------------------------- | --------------------------- |
| `module-boundaries.md`              | Module dependency graph     |
| `api-boundaries.md`                 | API + error model           |
| `event-model.md`                    | Events + observability      |
| `technical-decisions.md`            | ADRs incl. modular monolith |
| `../planning/roadmap.md`            | Phases                      |
| `../planning/cost-vendor-review.md` | Cost/vendor review          |
