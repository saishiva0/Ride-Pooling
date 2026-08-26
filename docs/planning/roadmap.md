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
> modify the Phase 0/1/2 roadmap above; phase labels 3.1–3.16 and 3.18–3.19
> exist only in the per-phase notes under `docs/development/`.

- **Completed:** Phases 3.1–3.16 and 3.18–3.24. Latest verified state (Phase 3.24):
  backend 1039/1039 tests passing, mobile 444/444 tests passing, and every
  other gate green (typecheck, lint, build, `format:check`, `prisma validate`,
  `prisma migrate status`, `db:check`, `expo config`). The two failures carried
  as "pre-existing and unrelated" through Phase 3.23 are resolved: the Ride
  Engine history-count assertion was corrected in Phase 3.24 (the extra
  `RideStatusHistory` row is the legitimate first-accept transition, so the
  test — not the code — was wrong), and the `location-search` flake did not
  reproduce. **OD-005 (authentication mechanism) is RESOLVED**
  (phone + OTP via MSG91, backend-owned verification, opaque bearer sessions);
  **OD-004 (matching thresholds) is RESOLVED** (5 km pickup radius, ±60 min
  departure window, 5 km destination tolerance, no score, deterministic
  ranking, max 20 results, server-controlled config); **OD-007 (map provider)
  is RESOLVED** (Google Maps, Phase 3.20); **OD-008 (realtime transport +
  push provider) is fully RESOLVED** (Socket.io, Phase 3.22; Expo Notifications
  - Expo Push Service, Phase 3.23). OD-010 remains OPEN. **OD-009 (ride
    chat/communication) is RESOLVED** as V1.1 (documentation-only scope decision;
    no V1 Chat implementation).
    See `docs/development/phase-3-*-notes.md`.
- **Proposed (NOT approved):** Phase 3.17 — Mobile Ride Creator Flow
  (create → publish → my rides → active ride → history). Spec pending approval:
  `docs/planning/phases/phase-3-17.md`.
- **Completed:** Phase 3.24 — Reporting & Blocking. Narrowed from the original
  "Verification & Safety" concept to reporting and blocking only; identity
  verification is explicitly deferred to a future, OD-010-dependent phase.
  This narrowing did not resolve OD-010. Spec:
  `docs/planning/phases/phase-3-24.md`; notes:
  `docs/development/phase-3-24-notes.md`.
- **Deferred to V1.1:** Phase 3.25 — Chat / Communication. OD-009 is RESOLVED
  as V1.1. No Chat implementation is part of V1. Planning placeholder:
  `docs/planning/phases/phase-3-25.md`.
- Open decision OD-010 must not be resolved by any implementation phase
  without an explicit decision. Phase 3.24's scope narrowing (reporting &
  blocking only) does not resolve OD-010; identity verification remains
  deferred pending it.

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
| `../product/v1-scope.md`                 | V1 scope                  |
| `../architecture/technical-decisions.md` | ADRs driving foundation   |
