# Phase 3.17 — Mobile Ride Creator Flow

> Status: **PROPOSED — for approval. NOT implemented.**
>
> This planning artifact defines the V1 Creator-side marketplace flow using
> current repository requirements and decisions. It does not authorize any
> later phase and does not resolve an open decision.

## 0. Current decision baseline

The original Phase 3.17 proposal predates several decisions that are now
resolved. This revision reconciles those references without expanding scope:

- **OD-005 authentication:** RESOLVED — phone + OTP via MSG91, backend-owned
  verification and opaque bearer sessions. No auth redesign is in scope.
- **OD-004 matching:** RESOLVED — 5 km pickup radius, ±60 minute departure
  window, 5 km destination tolerance, deterministic ranking, maximum 20
  results, server-controlled configuration. This phase reuses discovery and
  does not alter matching.
- **OD-007 maps/location provider:** RESOLVED — Google Maps. This phase reuses
  existing location/routing seams and does not introduce a provider change.
- **OD-008 realtime/push:** RESOLVED — Socket.io realtime and Expo Push Service.
  Existing notification/realtime behavior may be reused where already wired;
  this phase does not redesign either system.
- **OD-009 chat:** RESOLVED as **V1.1**. Chat remains out of scope for this V1
  creator-flow phase.
- **OD-010 identity verification:** OPEN. No verification behavior is added.
- **OD-012 post-publication editing:** OPEN. No new editing policy is added.
- **OD-013 reporting/blocking retention:** OPEN. Existing safety behavior is
  reused without inventing retention rules.
- **OD-018 rounding:** OPEN. Existing formatting/domain behavior is reused.

## 1. Title

**Mobile Ride Creator Flow** — create → publish → my rides → active ride →
history, completing the Creator side of the V1 marketplace loop.

## 2. Objective

Complete the mobile Creator experience for the canonical V1 loop:
create → publish → discover → request → accept → confirm → start → complete.
Participant discovery/request/decision capabilities already exist. This phase
adds the creator-facing lifecycle and management experience needed to operate
a ride end-to-end from mobile.

## 3. In scope

1. **Create Ride:** pickup, destination, departure date/time, available seats,
   pricing selection/value, and optional discovery radius using existing
   canonical validation and `RideApi.createRide`. New provider or pricing
   policy is not introduced.
2. **Draft → Publish:** creator can publish a draft; published rides use the
   existing discovery path and resolved matching configuration.
3. **My Rides:** authenticated creator can list their rides with current status
   and open a ride detail view.
4. **Request management:** creator can review pending join requests and use
   the existing accept/reject operations and domain rules.
5. **Active Ride:** creator can start a ride and later complete it using the
   existing lifecycle state machine and history requirements.
6. **Ride History:** creator can view completed/past rides.
7. **Notifications/realtime:** reuse existing Phase 3.8/3.22/3.23 behavior
   where lifecycle events already have canonical notification mappings; no new
   notification policy is invented.

## 4. Explicitly out of scope

- Post-publication editing policy — OD-012 remains open.
- New cancellation/grace-period policy — OD-002 remains open; existing cancel
  behavior is reused.
- Changes to matching thresholds, ranking, or discovery semantics — OD-004 is
  already resolved and reused as-is.
- Changes to Google Maps/routing/geocoding integration — OD-007 is resolved and
  reused as-is.
- New realtime transport, push provider, or delivery architecture — OD-008 is
  resolved and reused as-is.
- Chat/communication — OD-009 is resolved as V1.1.
- Identity verification — OD-010 remains open.
- New vehicle-type policy — OD-003 remains open.
- Reporting/blocking retention policy — OD-013 remains open.
- Payments, offline sync, background tracking, admin, analytics, or other
  post-V1 capabilities.

## 5. Dependencies

Existing capabilities are prerequisites: Ride Engine lifecycle/state machine,
transactional creation and history, request/seat decisions, cancellation,
notifications, authenticated API boundaries, mobile ride API, location seams,
realtime, and push infrastructure.

No new third-party dependency is required by this scope. The existing Prisma
schema is expected to be sufficient; if implementation discovers a genuine
schema gap, stop and report it rather than inventing a field or migration.

## 6. Acceptance criteria

1. A creator can create a valid ride and it is persisted as `DRAFT` with the
   required status history.
2. A creator can publish a draft and the ride becomes discoverable under the
   existing resolved discovery/matching rules.
3. A creator can see their own rides and open ride details.
4. A creator can accept/reject eligible join requests using authoritative
   backend rules.
5. A creator can start a valid ride and the transition is persisted in
   `RideStatusHistory` with existing notification behavior.
6. A creator can complete an in-progress ride and the transition is persisted
   in `RideStatusHistory` with existing notification behavior.
7. Ride history exposes completed/past creator rides.
8. Backend authorization remains authoritative; creator-only operations cannot
   be performed for another user's ride.
9. Existing participant functionality and all existing tests remain intact.
10. No open decision is resolved or silently changed by implementation.

## 7. Backend implementation plan

Additive application/use-case and HTTP work should follow existing project
patterns:

- `publishRide`: `DRAFT → PUBLISHED`.
- `startRide`: valid `PUBLISHED`/`CONFIRMED → IN_PROGRESS` transition according
  to the existing lifecycle/domain rules.
- `completeRide`: `IN_PROGRESS → COMPLETED`.
- Creator ride list and ride detail read paths.
- Creator authorization derived from the authenticated session, never from a
  caller-supplied creator identity.
- Lifecycle persistence and status history in the same transaction conventions
  already used by the Ride Engine.
- Existing notification/realtime mapping only; no new product semantics.

Routes remain under `/api/v1/rides` and use the established `{ data }` /
`{ error }` response envelope and normalized error model.

## 8. Mobile implementation plan

- Create Ride screen using existing API/location/domain helpers.
- My Rides screen with status and empty/loading/error states.
- Creator ride detail actions for publish/start/complete and request decisions.
- Active Ride and Ride History screens/flows as required by the existing
  navigation architecture.
- Typed routes through the existing framework-free navigation layer.
- Deterministic Vitest render/API tests with typed fakes; no real network.

## 9. Database

**No schema change expected.** Existing `Ride`, `RideStatusHistory`,
`RideRequest`, `RideParticipant`, status and lifecycle structures are reused.
No migration is authorized merely to make implementation convenient.

## 10. Testing and quality gates

Backend:

- unit/domain/use-case tests;
- PostgreSQL integration tests for lifecycle persistence/history;
- HTTP tests for validation, authorization, envelopes and transitions;
- typecheck, lint, test, build;
- Prisma validate/migrate status and DB check.

Mobile:

- API/render/navigation tests for create, publish, My Rides, start, complete
  and history;
- typecheck, lint and test;
- Expo config validation.

Repository-wide:

- `format:check`;
- `git diff --check`.

No existing test may be weakened or deleted.

## 11. Definition of done

1. All in-scope Creator capabilities are implemented and tested.
2. Existing V1 participant flows remain green.
3. No open decision is resolved or reinterpreted.
4. No unnecessary dependency or schema migration is introduced.
5. Backend/mobile quality gates and repository formatting gates pass.
6. `docs/development/phase-3-17-notes.md` records implementation and
   verification evidence.
7. The final report explicitly stops before starting another phase.

**Approval gate:** This document remains **PROPOSED** until explicitly
approved. Implementation must not begin solely because this specification has
been reconciled.
