# RidePool — V1 Definition of Done

> Status: Phase 0 — Planning
> Defines what must be true for RidePool V1 to be considered done.

## 1. Product Outcomes

A user must be able to:

1. Register.
2. Log in.
3. Create a ride.
4. Define a route (pickup → destination).
5. Define date/time.
6. Define available seats.
7. Select standard or custom price (within configured range).
8. Publish the ride.
9. Discover nearby rides.
10. View ride details (route, seats, distance, price/km, estimated
    contribution, status).
11. Request to join.
12. Creator accepts/rejects.
13. Participant sees the result.
14. Confirmed participants see the ride.
15. Ride transitions through the full lifecycle (publish → confirm → start →
    complete).
16. Ride can be cancelled according to rules.
17. Ride can be completed.
18. Users can view ride history.
19. Users receive essential notifications.
20. Core functionality works reliably on mobile.

## 2. Domain Correctness

- Deterministic state machine implemented per
  `docs/domain/ride-lifecycle.md` (7 states, no `REQUESTED`).
- All invariants in `docs/domain/ride-engine.md` §5 enforced.
- Overbooking impossible (transactional seat allocation, ADR-011).
- Duplicate active requests prevented.
- Pricing validated within configured limits (₹4 standard; ₹2–6 custom).

## 3. System Requirements

- Modular monolith backend (Node + TS) with modules per
  `docs/architecture/module-boundaries.md`.
- PostgreSQL database (Prisma schema in later phase).
- REST API per `docs/architecture/api-boundaries.md`; WebSocket real-time.
- Mobile app (React Native/Expo direction) implementing screen groups from
  `docs/architecture/system-architecture.md` §10.
- In-app notifications at minimum (push = OD-008).
- Health check endpoint; structured logging; no PII/location in logs.

## 4. Quality Gates

- Unit, integration, and API tests pass (incl. concurrency tests for seat
  allocation).
- Auth/authorization enforced on all creator/participant actions.
- Lint + typecheck pass.
- Manual end-to-end mobile walkthrough of the primary journey succeeds.

## 5. Non-Deliverables

The following are explicitly **not** part of V1 DoD (see
`docs/product/v1-scope.md`):

- Payments, wallets, payouts, commission.
- AI matching.
- Surge pricing.
- Admin dashboard.
- Ride chat (OD-009 resolved: deferred to V1.1).
- Fleet/vehicle ownership.

## 6. Document Map

| Related doc                   | Purpose                      |
| ----------------------------- | ---------------------------- |
| `roadmap.md`                  | Phase sequencing             |
| `open-decisions.md`           | Items blocking DoD decisions |
| `../product/v1-scope.md`      | Scope definition             |
| `../domain/ride-lifecycle.md` | State machine DoD source     |
