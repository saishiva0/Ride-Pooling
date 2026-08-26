# RidePool — Product Requirements Document (PRD)

> Status: Phase 0 — approved product definition
> Version: 1.0 (draft)
> Owner: Product / Tech Lead

---

## 1. Executive Summary

RidePool is a mobile-first ride-sharing platform that connects **Ride Creators**
(people already travelling with available capacity) with **Ride Participants**
(people travelling in a compatible direction). It is a technology platform that
connects people; it does not own vehicles, operate a fleet, or employ drivers.

The core value proposition is: **"Connect people already going the same way."**

V1 focuses on the deterministic core marketplace loop: create → discover →
match → request → accept → ride → complete. Pricing is transparent cost
sharing with a recommended rate and a validated custom range. V1 has **no
payments, no platform commission, and no AI matching**.

## 2. Problem Statement

Vehicles regularly travel with unused capacity while other people travel the
same route at the same time. There is no lightweight, mobile-first way for two
people going the same way to discover each other, agree to share a ride, and
share costs transparently. Existing alternatives are either commercial
ride-hailing (fleet/driver-centric, commission-heavy) or unstructured informal
arrangements.

## 3. Product Vision

People who are already travelling in a particular direction share available
capacity with people travelling along a compatible route. RidePool is the
trusted, simple, transparent layer that makes this possible.

## 4. Goals (V1)

1. Enable a user to create and publish a ride with minimal effort.
2. Enable a participant to discover compatible rides and request to join.
3. Make the ride lifecycle deterministic and overbooking impossible.
4. Make pricing transparent: recommended rate + validated custom price.
5. Deliver a reliable mobile-first MVP that completes the full ride lifecycle.

## 5. Non-Goals (V1)

- No payment processing, wallets, payouts, or platform commission.
- No AI/ML matching.
- No surge/dynamic pricing.
- No fleet management, vehicle ownership, or driver employment.
- No coupons, loyalty, or subscriptions.
- No multi-modal or autonomous transportation.
- No cryptocurrencies or blockchain.
- No continuous background location tracking assumption.
- No ride chat/communication in V1 (deferred to V1.1 per OD-009).

## 6. Target Users

- Daily commuters with cars who have spare seats (Creators).
- People without cars who want predictable, affordable shared travel
  (Participants).
- Occasional intercity travellers (both roles).
- See `docs/product/user-personas.md`.

## 7. Personas

Riya (commuter Creator), Arjun (discovery Participant), Meera (occasional
intercity, both roles), Harsha (cautious first-time Participant), Vikram
(reliability-focused Creator). See `docs/product/user-personas.md`.

## 8. Core User Journeys

See `docs/product/user-flows.md`:

- Primary: create → publish → discover → request → accept → confirm → start →
  complete.
- Secondary: rejected participant remains available.
- Cancellation: validate rules → update state → notify → record.

## 9. Feature Requirements

### 9.1 Account & Auth (V1)

- FR-001 Register with a phone/email + OTP or password (method = open decision
  OD-005).
- FR-002 Login / logout, session tokens.
- FR-003 Profile: name, contact, basic vehicle info (creator side, optional),
  trust/verification placeholders.
- FR-004 Account preferences (default radius, default pricing preference).

### 9.2 Ride Creation (V1)

- FR-010 Create ride with pickup, destination, date, time, seats, pricing,
  optional vehicle type and radius.
- FR-011 Validate: future departure, seats ≥ 1, price within configured range.
- FR-012 Save as `DRAFT`, editable, then `PUBLISH`.

### 9.3 Ride Discovery (V1)

- FR-020 Discover nearby rides filtered by radius, time, destination relevance,
  seat availability, price, and status.
- FR-021 Sort by relevance (see matching model).
- FR-022 View ride details including estimated contribution.

### 9.4 Ride Request (V1)

- FR-030 Request to join a ride; duplicate active requests prevented.
- FR-031 Track request state: `PENDING` → `ACCEPTED`/`REJECTED`/`CANCELLED`.
- FR-032 Participant may withdraw a `PENDING` request where permitted.

### 9.5 Seat Management (V1)

- FR-040 Transactionally allocate seats on acceptance; prevent overbooking.
- FR-041 Restore seats on participant cancellation.
- FR-042 Track available seats accurately at all times.

### 9.6 Ride Lifecycle (V1)

- FR-050 Deterministic state machine (see `docs/domain/ride-lifecycle.md`).
- FR-051 Record `RideStatusHistory` on every transition.
- FR-052 Cancel per rules with notifications and history.

### 9.7 Notifications (V1)

- FR-060 Ride request, request accepted, request rejected, ride reminder, ride
  cancellation, and ride state changes.

## 10. Ride Engine Requirements

The Ride Engine is the central domain. Full specification:
`docs/domain/ride-engine.md`.

## 11. Pricing Requirements

Full spec: `docs/domain/pricing-model.md`.

- Recommended standard rate: **₹4/km** (reference, cost-sharing).
- Custom range: **₹2/km – ₹6/km** (validated; configurable, not hardcoded).
- `estimatedContribution = estimatedDistanceKm × pricePerKm`.
- Terminology: price per km, estimated contribution, recommended rate,
  cost sharing. Not "fare".

## 12. Matching Requirements

Full spec: `docs/domain/matching-model.md`.

- Deterministic factors: pickup proximity, destination compatibility, time
  compatibility, seat availability, ride status.
- Thresholds (radius, time window, destination tolerance) are **PRODUCT
  DECISIONS REQUIRED** — not arbitrarily invented here.

## 13. Location Requirements

Full spec: `docs/domain/domain-model.md` (Location) and
`docs/domain/matching-model.md`.

- Latitude/longitude for pickup, destination, and user current location.
- Search radius; distance calculation; route compatibility.
- Separate **User Location** from **Ride Location**.
- No continuous background tracking assumption; permission-gated and minimal.

## 14. Notifications Requirements

- Ride request, accepted, rejected, reminder, cancellation, state changes.
- Delivered in-app (real-time) at minimum; push provider = open decision
  (OD-008).

## 15. Safety Requirements

- Reporting and blocking (V1 baseline).
- Cancellation controls and clear rules.
- User safety info on profile.
- Basic verification (degree of verification = open decision OD-010).
- Abuse prevention (rate limiting, duplicate prevention).

## 16. Non-Functional Requirements

Full spec: `docs/architecture/system-architecture.md`.

- Fast API responses, efficient location queries.
- Scalable from MVP to larger user base without rewrite.
- Reliable, consistent ride states; transactional seat allocation.
- Secure by default; privacy by design.
- Observability from the start.

## 17. Success Metrics

See `docs/architecture/event-model.md` and the metrics section below.

| Metric             | Definition                               |
| ------------------ | ---------------------------------------- |
| Users registered   | Unique accounts created                  |
| Rides created      | Rides in `DRAFT` or beyond               |
| Rides published    | Rides that reached `PUBLISHED`           |
| Rides discovered   | Unique participant view/discover actions |
| Ride requests      | Requests created                         |
| Requests accepted  | Requests accepted                        |
| Rides confirmed    | Rides that reached `CONFIRMED`           |
| Rides completed    | Rides that reached `COMPLETED`           |
| Cancellation rate  | Cancelled rides ÷ confirmed rides        |
| Match success rate | Requests accepted ÷ requests             |
| Repeat users       | Users with >1 ride activity              |

**Primary marketplace metric:**
`Completed Shared Rides ÷ Published Rides`.

Why: it measures whether published rides actually convert into completed
shared journeys — the core value of the platform. It captures both supply
(publication) and demand (completion) in one ratio and is the clearest single
signal of marketplace health.

> No target numbers are invented in this phase; targets will be set after
> product validation (see `docs/planning/open-decisions.md` OD-014).

## 18. V1 Scope

See `docs/product/v1-scope.md`.

## 19. Future Scope

See `docs/planning/roadmap.md`. V1.1/V2/future items are ideas, not committed.
Ride chat/communication is deferred to V1.1 per OD-009; detailed Chat
requirements will be defined in the V1.1 Chat planning phase.

## 20. Risks

See `docs/planning/risk-register.md`.

## 21. Open Decisions

See `docs/planning/open-decisions.md` (OD-001 … OD-0xx).

## 22. Document Map

| Doc                 | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `product-vision.md` | Vision and principles                              |
| `user-personas.md`  | Roles and personas                                 |
| `user-flows.md`     | Journeys                                           |
| `v1-scope.md`       | Scope in/out                                       |
| `domain/*`          | Engine, lifecycle, pricing, matching, domain model |
| `architecture/*`    | System, modules, APIs, events, decisions           |
| `planning/*`        | Roadmap, DoD, open decisions, risks, legal, cost   |
