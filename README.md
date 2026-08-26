# RidePool

**"Connect people already going the same way."**

RidePool is a mobile-first ride-sharing platform connecting **Ride Creators**
(people already travelling with available capacity) with **Ride Participants**
(people travelling in a compatible direction). It is a technology platform that
connects people — it does not own vehicles, operate a fleet, or employ drivers.

> **Phase 0 — Product Definition & Architecture (complete).**
> **Phase 1 — Engineering Foundation (current).** Documentation from Phase 0 is
> the source of truth and is preserved under `docs/`.

## Repository Layout (Phase 1+)

```
apps/backend     # RidePool API (modular monolith, Node.js + TypeScript)
apps/mobile      # RidePool mobile app (React Native + Expo)
packages/shared  # Shared types/constants/contracts
packages/config  # Shared configuration utilities
docs/            # Phase 0 product/domain/architecture + Phase 1 dev docs
scripts/         # Repository helper scripts
```

## Scripts (run from root)

| Command             | Purpose                                  |
| ------------------- | ---------------------------------------- |
| `pnpm install`      | Install all workspace dependencies       |
| `pnpm dev`          | Run backend + mobile in development mode |
| `pnpm build`        | Build all workspaces                     |
| `pnpm lint`         | Lint all workspaces                      |
| `pnpm test`         | Run tests in all workspaces              |
| `pnpm typecheck`    | Type-check all workspaces                |
| `pnpm format`       | Format all files with Prettier           |
| `pnpm format:check` | Verify formatting                        |

Requires Node.js >= 20 and pnpm >= 9. See `docs/development/setup.md`.

## Documentation Index

```
docs/
├── product/       # Vision, PRD, personas, flows, V1 scope
├── domain/        # Ride Engine, lifecycle, pricing, matching, domain model
├── architecture/  # System, modules, APIs, events, ADRs
├── planning/      # Roadmap, DoD, open decisions, risks, legal, cost
└── development/   # Phase 1: setup, workflow, environment, database, testing
```

## Key Decisions at a Glance

- Ride Engine is the central business domain (Phase 2+).
- Modular monolith for MVP (ADR-003).
- PostgreSQL + PostGIS; Prisma; Zod; Socket.io (direction, ADR-010 Proposed).
- Deterministic matching, no AI/ML (ADR-007).
- No payments, no platform commission in V1 (ADR-005/006).
- Recommended rate ₹4/km; custom ₹2–6/km (configurable, not hardcoded).
- 7 ride states: DRAFT, PUBLISHED, CONFIRMED, IN_PROGRESS, COMPLETED,
  CANCELLED, EXPIRED.

## Open Decisions

See `docs/planning/open-decisions.md` (OD-001 … OD-019). Thresholds, providers,
auth method, and regulatory items are explicitly not arbitrarily resolved.

## Recommended Next Phase

Phase 2 — Domain Model & Database (not started; stop after Phase 1).
