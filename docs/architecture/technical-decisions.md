# RidePool — Technical Decision Record (ADRs)

> Status: Phase 0 — Architecture Planning
> Decision log. Status values: **Accepted** (decided for V1) ·
> **Proposed** (direction, to be validated) · **Deferred** (open).

## ADR-001 — Mobile-first architecture

- **Decision:** The primary user experience is a mobile application.
- **Context:** Ride discovery and request/accept flows are location- and
  time-sensitive; target users are phone-centric.
- **Rationale:** Matches the core value proposition and user behaviour.
- **Consequences:** Mobile client first; backend is API-first; web is
  secondary/none in V1.
- **Status:** Accepted.

## ADR-002 — Ride Engine as core domain

- **Decision:** Ride Engine is the central business domain owning lifecycle,
  discovery, matching, requests, seats, pricing, and history.
- **Context:** Everything RidePool does routes through the ride lifecycle.
- **Rationale:** Single source of truth for ride behaviour; other modules
  consume its events.
- **Consequences:** Clear ownership; modules integrate with, not inside, the
  engine.
- **Status:** Accepted.

## ADR-003 — Modular monolith for MVP

- **Decision:** Single deployable backend, logically modular.
- **Context:** Two-person team, limited budget, V1 timeline.
- **Rationale:** Simplest reliable deployment; avoids distributed-system
  overhead.
- **Consequences:** Modules separated in code; deploy as one unit; scale out
  later if needed.
- **Status:** Accepted.

## ADR-004 — PostgreSQL as primary database

- **Decision:** PostgreSQL (+ PostGIS for geospatial queries).
- **Context:** Location-aware discovery needs efficient nearby queries;
  transactional integrity required for seats/state.
- **Rationale:** Mature, open-source, relational + geospatial, transactions.
- **Consequences:** Prisma ORM target; PostGIS optional extension.
- **Status:** Accepted.

## ADR-005 — No platform commission in V1

- **Decision:** RidePool adds no commission to creators or participants in V1.
- **Context:** Product positioning is cost sharing, not commercial rides.
- **Rationale:** Low friction adoption; validates marketplace before
  monetization.
- **Consequences:** No commission accounting; monetization deferred to a later
  phase.
- **Status:** Accepted.

## ADR-006 — No payment processing in V1

- **Decision:** No payments, wallets, payouts in V1.
- **Context:** Contribution is transparent but cash settlement is outside V1.
- **Rationale:** Avoids payment complexity/legal scope; core loop is
  coordination.
- **Consequences:** Contribution shown but not collected; payment = future
  phase.
- **Status:** Accepted.

## ADR-007 — Deterministic matching in V1

- **Decision:** V1 matching uses deterministic business rules, not AI/ML.
- **Context:** Predictable, testable, transparent discovery.
- **Rationale:** MVP correctness and debuggability; ML not needed to validate
  marketplace.
- **Consequences:** No ML infra; thresholds are product decisions (OD-004).
- **Status:** Accepted.

## ADR-008 — Creator-controlled pricing within configured limits

- **Decision:** Creator picks standard (₹4/km) or custom price within
  configured range (₹2–6/km).
- **Context:** Cost sharing must stay reasonable and transparent.
- **Rationale:** Balances creator choice with fairness; configurable.
- **Consequences:** Validation at creation; no hardcoded values; config-driven.
- **Status:** Accepted.

## ADR-009 — No premature microservices

- **Decision:** No microservices, Kubernetes, service mesh, or event streaming
  for the MVP.
- **Context:** Small team; MVP scale; modular monolith sufficient.
- **Rationale:** Avoids operational complexity with no current requirement.
- **Consequences:** Revisit only when an actual requirement justifies it.
- **Status:** Accepted.

## ADR-010 — Technology stack direction (PROPOSED)

- **Decision:** Mobile: React Native + Expo. Backend: Node.js + TypeScript.
  DB: PostgreSQL. ORM: Prisma. Validation: Zod. Real-time: Socket.io.
  Monorepo: pnpm + Turborepo.
- **Context:** Compatible with a two-person, one-month MVP delivery.
- **Rationale:** Single language (TS) across client/server, mature ecosystem,
  low-cost tooling.
- **Consequences:** Shared TS contracts; OSS cost profile.
- **Review note:** Final stack must be validated for compatibility, maturity,
  DX, cost, and one-month feasibility before locking. See
  `docs/planning/open-decisions.md` (OD-015) and
  `docs/planning/cost-vendor-review.md`.
- **Status:** Proposed.

## ADR-011 — Transactional seat allocation

- **Decision:** Seat allocation (request acceptance) is transactional and
  overbooking-proof.
- **Context:** Last-seat race between concurrent requests.
- **Rationale:** Overbooking breaks core invariants and trust.
- **Consequences:** Row locks/conditional updates; concurrency tests required.
- **Status:** Accepted.

## ADR-012 — Privacy by design for location

- **Decision:** Minimal location collection; permission-gated; no continuous
  background tracking.
- **Context:** Location is core but sensitive.
- **Rationale:** Trust and legal/privacy posture.
- **Consequences:** User current location is ephemeral; ride locations are
  consented published data.
- **Status:** Accepted.

## Document Map

| Related doc                         | Purpose                     |
| ----------------------------------- | --------------------------- |
| `system-architecture.md`            | Architecture context        |
| `module-boundaries.md`              | Modular monolith structure  |
| `../planning/open-decisions.md`     | Items still open            |
| `../planning/cost-vendor-review.md` | Vendor/cost review required |
