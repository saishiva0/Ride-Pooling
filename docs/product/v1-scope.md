# RidePool — V1 Scope

> Status: Phase 0 — Product Definition
> This document defines what is IN V1 and what is EXPLICITLY OUT OF SCOPE.

## 1. In Scope for V1

The complete, deterministic marketplace loop for ride sharing:

1. Account registration & login (method = open decision OD-005).
2. Profile with basics (name, contact, optional vehicle info).
3. Ride creation with pickup, destination, date, time, seats, pricing, optional
   vehicle type and radius.
4. Ride publishing (`DRAFT → PUBLISHED`).
5. Ride discovery and matching using deterministic rules.
6. Ride details with transparent pricing (distance, price/km, estimated
   contribution).
7. Join requests with states and duplicate prevention.
8. Creator accept/reject of requests.
9. Confirmed participants and transactional seat management.
10. Ride lifecycle: publish → confirm → start → complete, plus cancel and
    expire paths.
11. Ride and request history.
12. Essential notifications (request, accepted, rejected, reminder,
    cancellation, state changes).
13. Basic safety: reporting, blocking, profile info, cancellation controls.
14. Mobile-first UX for all of the above.

## 2. Explicitly Out of Scope for V1

The following are OUT OF SCOPE unless later approved:

- Fleet management
- Vehicle ownership
- Driver employment management
- Dynamic / surge pricing
- AI matching / machine learning
- Wallets
- Platform commission
- Payment processing
- Driver payouts
- Coupons
- Loyalty system
- Corporate fleet management
- Advanced subscriptions
- Complex social networking
- Advanced recommendation engine
- Multi-modal transportation
- Autonomous transportation
- Cryptocurrency / unnecessary blockchain functionality
- Ride chat / communication (deferred to V1.1 per OD-009)

## 3. Payment Decision (V1)

RidePool V1 will **NOT** process ride payments.

V1 focuses on:

- Ride discovery
- Ride matching
- Ride requests
- Ride coordination
- Cost contribution transparency

No payment architecture, wallet, payout, or commission accounting is designed
in Phase 0. Payments may be evaluated in a future phase after validating the
core marketplace and reviewing applicable legal/business requirements.

## 4. Business Model Decision (V1)

- RidePool acts as a **technology platform connecting participants**.
- **No platform commission** in V1.
- No fleet ownership, no vehicle ownership, no driver employment model.
- No payment processing in V1.

> **LEGAL / REGULATORY REVIEW REQUIRED**
> The business model and applicable regulatory classification must be reviewed
> for the launch jurisdiction before public commercial launch. RidePool does
> not claim legal exemption because it acts as a "middleman". See
> `docs/planning/legal-regulatory-note.md`.

## 5. Technology Constraint (V1)

- **Mobile first.** Primary experience is a mobile application.
- **Deterministic first.** Matching uses business rules, not AI/ML.

## 6. Module Inclusion (V1)

| Module                                                                  | V1                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| User & Authentication                                                   | ✅ Core                                                       |
| Ride Engine (creation, discovery, matching, requests, seats, lifecycle) | ✅ Core                                                       |
| Location & Maps                                                         | ✅ Core (discovery/distance; map provider = OD-007)           |
| Real-time                                                               | ✅ Supporting                                                 |
| Notifications                                                           | ✅ Supporting                                                 |
| Safety & Trust                                                          | ✅ Baseline                                                   |
| Communication                                                           | ⛔ Not in V1 (deferred to V1.1; OD-009 resolved)              |
| Admin                                                                   | ⛔ Future                                                     |
| Analytics                                                               | 🔶 Observability metrics only in V1; product analytics future |

Legend: ✅ in V1 · 🔶 partial/deferred · ⛔ not in V1

## 7. Non-Goal Clarifications

- No "taxi fare" / "commercial fare" positioning. Pricing is presented as
  **estimated contribution / cost sharing**.
- No continuous background location tracking.
- No legal claims about transportation exemption.

## 8. Success Metrics for V1

Primary: `Completed Shared Rides ÷ Published Rides`.

Full metrics list: `docs/product/product-requirements.md` § 17.

## 9. Definition of Done

See `docs/planning/v1-definition-of-done.md`.

## 10. Open Decisions Affecting Scope

- OD-003 vehicle types (cars only vs cars + bikes)
- OD-005 authentication method
- OD-007 map provider
- OD-009 communication (chat) — RESOLVED: deferred to V1.1
- OD-010 verification requirements

Full list: `docs/planning/open-decisions.md`.

## 11. Document Map

| Related doc                         | Purpose                 |
| ----------------------------------- | ----------------------- |
| `product-requirements.md`           | Full PRD                |
| `product-vision.md`                 | Vision & principles     |
| `user-flows.md`                     | Journeys                |
| `domain/ride-engine.md`             | Engine responsibilities |
| `planning/roadmap.md`               | Future phases           |
| `planning/legal-regulatory-note.md` | Legal review required   |
