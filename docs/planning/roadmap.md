# RidePool — Roadmap

> Status: Phase 0 — Planning
> Phase sequencing. Future items are ideas, not committed features.

## Phase 0 — Product Definition & Architecture (CURRENT)

- Product vision, PRD, personas, flows, V1 scope.
- Domain model, Ride Engine spec, lifecycle, pricing, matching.
- Architecture, module boundaries, API/event boundaries, ADRs.
- Planning: roadmap, DoD, open decisions, risk register, legal/cost notes.

**Exit criteria:** All Phase 0 docs consistent; open decisions OD-001..019
documented; no code written.

## Phase 1 — Engineering Foundation (RECOMMENDED NEXT)

- Monorepo scaffolding (pnpm + Turborepo), TS config.
- Backend module skeleton (modular monolith).
- PostgreSQL + Prisma schema (entities from `docs/domain/domain-model.md`).
- Auth (method per OD-005).
- Ride Engine core: creation, lifecycle state machine, requests, seats,
  pricing, history.
- API boundary implementation per `docs/architecture/api-boundaries.md`.
- Basic discovery (matching thresholds per OD-004).
- Testing foundation (unit/integration/API + concurrency tests).
- Mobile app scaffold (React Native/Expo) + core screens.
- Real-time (Socket.io) + in-app notifications.

## Phase 1.1 (post-core validation)

- Better matching & location quality.
- Improved notifications (push per OD-008).
- Communication / ride chat (OD-009 resolved: V1.1).
- Safety hardening.

## Phase 2

- Payments (post legal/business review).
- Recurring rides / saved routes.
- Advanced matching.
- Organization / campus groups.

## Engineering Implementation Track (Phases 3.x)

> Audit record. The 3.x track implements the Phase 1/2 engineering work as a
> series of incremental, independently verified phases. It does not replace or
> modify the Phase 0/1/2 roadmap above; phase labels 3.1–3.16 and 3.18–3.25
> exist only in the per-phase notes under `docs/development/`.

- **Completed:** Phases 3.1–3.16 and 3.18–3.25. Latest verified state includes
  Reporting & Blocking (3.24) and Chat / Communication (3.25, V1.1 scope), with
  the applicable backend/mobile quality gates passing. OD-005 authentication,
  OD-004 matching thresholds, OD-007 Google Maps, OD-008 Socket.io + Expo Push
  Service, and OD-009 Chat scope are resolved. OD-010 identity verification and
  OD-013 retention remain open.
- **Proposed (NOT approved):** Phase 3.17 — Mobile Ride Creator Flow
  (create → publish → my rides → active ride → history). The scope is
  canonical V1 capability, but sequencing/approval remains pending:
  `docs/planning/phases/phase-3-17.md`.
- **Completed / deferred:** Phase 3.26 — Payments discovery concluded
  **BLOCKED / NOT APPLICABLE TO V1**. Payment processing, wallets and payouts
  remain post-V1; no implementation is authorized by this phase.
  Discovery report: `docs/development/phase-3-26-payments-discovery-report.md`.
- **Completed / deferred:** Phase 3.27 — Offline & Reliability discovery
  concluded **BLOCKED / NOT APPLICABLE TO V1**. The existing V1 reliability
  contract is online degradation/reconnect + REST recovery; an offline sync
  engine, outbox/event replay and offline writes are post-V1. No implementation
  is authorized by this phase.
- **Next planning gate:** Before implementing any future feature, reconcile
  the proposed Phase 3.17 specification with decisions resolved after it was
  authored. In particular, do not reopen or invent decisions already resolved
  by Phases 3.18–3.25.
- **OD-010 gate:** Identity verification remains a separate open decision and
  must be investigated before any verification implementation is authorized.

## Future / Post-V1

- Phase 3.26 — Payments: post-V1.
- Phase 3.27 — Offline sync engine / outbox / event replay: post-V1.
- Other V1.1/V2 items remain subject to their documented product decisions.

## Future (ideas, not committed)

- Corporate commuting.
- Community partnerships.
- Advanced analytics.
- Dynamic marketplace optimization.

## Non-Roadmap (explicitly excluded unless later approved)

Fleet management, vehicle ownership, driver employment, surge pricing, AI
matching, wallets, commission, payouts, coupons, loyalty, subscriptions,
crypto/blockchain. See `docs/product/v1-scope.md`.

## Document Map

| Related doc                              | Purpose                   |
| ---------------------------------------- | ------------------------- |
| `v1-definition-of-done.md`               | V1 completion criteria    |
| `open-decisions.md`                      | Decisions blocking phases |
| `risk-register.md`                       | Risks by phase            |
| `../product/v1-scope.md`                 | Scope in/out              |
| `../architecture/technical-decisions.md` | ADRs driving foundation   |
