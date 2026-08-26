# Phase 3.17 (PROPOSED) — Mobile Ride Creator Flow

> Status: **PROPOSED — for approval. NOT approved, NOT implemented.**
>
> This document is a PLANNING artifact created by the Phase 3.17 planning
> investigation (task outcome: SAFE TO DEFINE). It proposes a canonical
> definition for the next engineering phase, drawn **only** from existing
> repository documentation (V1 scope, PRD, user flows, lifecycle, module/API
> boundaries, and the completed-phase notes). It resolves NO open decision.
> If approved, Phase 3.17 must be implemented only from this scope; nothing
> here authorizes Phase 3.18 or any other future phase.

## 0. Evidence classification

Every scope item below is labelled by evidence strength:

- **CANONICAL** — explicitly stated in repository documentation.
- **SUPPORTED** — not named as a phase, but directly supported by existing
  product/architecture/domain documents.
- **INFERENCE** — reasonable engineering-sequencing judgment, NOT explicitly
  approved.

| Item                                                                          | Evidence                                                                                                                                                                      | Label                                                               |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Create ride (pickup, destination, date/time, seats, pricing, optional radius) | PRD FR-010/011; `user-flows.md` §4.1; `v1-scope.md` §1.3; DoD §1.3–1.8; `system-architecture.md` §10 screen group `CREATE RIDE`                                               | CANONICAL                                                           |
| DRAFT → PUBLISH (ride becomes discoverable)                                   | PRD FR-012; `user-flows.md` §4.2; lifecycle states (`ride-lifecycle.md`); DoD §1.8                                                                                            | CANONICAL                                                           |
| Start (→ IN_PROGRESS) and Complete (→ COMPLETED)                              | `user-flows.md` §4.7/§4.8; DoD §1.15/§1.17; lifecycle states; `api-boundaries.md` §2 (rides: start, complete)                                                                 | CANONICAL                                                           |
| Creator "My Rides" + request management + Active Ride + Ride History          | `system-architecture.md` §10 screen groups `MY RIDES`, `ACTIVE RIDE`, `RIDE HISTORY`; DoD §1.14/§1.18; `api-boundaries.md` §2 (rides: list, detail); `v1-scope.md` §1.11      | CANONICAL                                                           |
| Mobile-first UX for all of the above                                          | `v1-scope.md` §1.14, §5 "Mobile first"                                                                                                                                        | CANONICAL                                                           |
| Backend must gain publish/start/complete/list operations                      | Backend currently ships only create/discover/match/request/accept/reject/cancel/expire (`ride.routes.ts`); publish/start/complete/list are canonically V1 lifecycle/API items | CANONICAL (capability) + INFERENCE (that a new phase must add them) |
| This specific capability is the NEXT phase ("Phase 3.17")                     | No repository document names Phase 3.17 or an ordering of the 3.x track                                                                                                       | INFERENCE                                                           |

> The SCOPE is canonical. Only the SEQUENCING (that this is Phase 3.17) is an
> inference, and it must not be treated as approved until a decision is made.

## 1. Title

**Mobile Ride Creator Flow** — create → publish → my rides → active ride →
history, closing the mobile creator half of the V1 marketplace loop.

## 2. Objective

Complete the mobile **Creator** side of the canonical V1 marketplace loop
(create → publish → discover → match → request → accept → ride → complete)
so that both roles of the platform work on mobile. The Participant side
(discovery, ride details, requests, notifications, decisions) is complete
(Phases 3.15/3.16); the Creator side is not.

## 3. Problem being solved

- V1 requires a mobile-first experience for the full loop
  (`v1-scope.md` §1.14, §5). Today a Creator cannot create, publish, start,
  complete, or list their rides from mobile.
- The backend `createRide` use case and the mobile `RideApi.createRide` client
  already exist but are unwired to any UI; publish/start/complete lifecycle
  operations are defined canonically but have no backend endpoint.
- `v1-definition-of-done.md` requires: create a ride, define route/date/time/
  seats/price, publish, confirm, start, complete, and view ride history.

## 4. In-scope functionality

1. **Ride creation (mobile + backend reuse):** Create Ride screen with pickup,
   destination, departure date/time, available seats, pricing selection
   (standard / custom within configured range), optional discovery radius.
   Validation per `ride-engine.md` §5 invariants (future departure, seats ≥ 1,
   price within range, route validity). Ride is saved in `DRAFT`.
   (CANONICAL: PRD FR-010/011, user-flows §4.1.)
2. **Publish:** `DRAFT → PUBLISHED`; ride becomes discoverable. (CANONICAL:
   PRD FR-012, user-flows §4.2.)
3. **Creator ride management ("My Rides"):** list the authenticated user's
   rides with status; open a ride's details. (CANONICAL: system-architecture
   §10 `MY RIDES`; api-boundaries §2 rides: list/detail.)
4. **Request management:** creator reviews and accepts/rejects join requests
   on their rides, reusing the existing decision UI/API surface built in Phase
   3.15 (notifications) and Phase 3.6 (backend accept/reject). (CANONICAL:
   user-flows §4.6, v1-scope §1.8.)
5. **Active Ride:** start (`PUBLISHED|CONFIRMED → IN_PROGRESS`) and complete
   (`IN_PROGRESS → COMPLETED`) by the creator, with `RideStatusHistory` and
   existing notification mapping. (CANONICAL: user-flows §4.7/§4.8; DoD §1.15/
   1.17.)
6. **Ride History:** view the user's past/completed rides. (CANONICAL: DoD
   §1.18, v1-scope §1.11, system-architecture §10 `RIDE HISTORY`.)

## 5. Explicitly out-of-scope

- **Post-publication ride editing** — OD-012 is OPEN (which fields editable,
  when). DRAFT editing is only the minimal "save draft then publish" step
  explicitly in FR-012; no field-editing matrix is invented.
- **Cancellation-window / grace-period policy** — OD-002 is OPEN. Creator
  cancel already exists (Phase 3.7) and is reused as-is; no new cancel rules
  are defined here.
- **Matching UI / scores / weights** — OD-004 is OPEN; discovery stays plain
  `GET /rides/discover`; no matching screen is built.
- **Map rendering, routing, geocoding, provider SDKs** — OD-007 is OPEN.
  Location input stays coordinate/label based via the existing provider-neutral
  seams.
- **Realtime client wiring, push** — OD-008 is OPEN; the fail-closed
  `unavailableRealtimeClient` stays; no socket UI integration.
- **Chat** — OD-009 is OPEN (V1.1 candidate); no communication.
- **Verification** — OD-010 is OPEN; no verification flows.
- **Vehicle-type selection** — OD-003 is OPEN; the vehicle-type field is
  optional in the domain model and is not made a required/validated input here.
- **Authentication UI / registration / login** — OD-005 is RESOLVED (Phase
  3.18: phone + OTP via MSG91, `AuthNavigator`); this phase makes no auth
  changes and adds no new auth UI.
- **Safety module (reporting/blocking), profile/preferences (users module),
  payments, admin, analytics, push, offline sync, background tracking.**

## 6. Dependencies

- **Prerequisites (already in the repo):** Phase 3.1 ride state machine and
  invariants; Phase 3.2 `createRide` + transactional persistence + history;
  Phase 3.6 accept/reject + seat allocation; Phase 3.7 cancel/expire; Phase 3.8
  notification mapping; Phase 3.10 HTTP boundary and auth middleware; Phase
  3.15 mobile ride API client (`RideApi.createRide`, request decisions) and
  screens/components/theme; Phase 3.16 location seams.
- **New capability the phase must add:** backend `publish`, `start`,
  `complete` operations and a creator "my rides"/ride-detail read path
  (list/detail per `api-boundaries.md` §2). These are canonical V1 lifecycle
  operations, not product-policy invention.
- **No new third-party dependency** is required for the in-scope work.

## 7. Existing decisions that must remain untouched

All remaining open decisions must NOT be resolved by this phase. In
particular: OD-002 (no new cancel/grace policy), OD-003 (no vehicle-type
validation), OD-004 (no matching thresholds/UI), OD-007 (no map provider),
OD-008 (no realtime wiring/push), OD-009 (no chat), OD-010 (no verification),
OD-012 (no post-publish edit rules), OD-018 (no
rounding-policy change; existing display formatting is reused as-is).
OD-005 is already resolved (Phase 3.18) and is unchanged by this phase.

## 8. Acceptance criteria

1. A Creator can create a ride with the canonical fields and validation; the
   ride is saved in `DRAFT` with `RideStatusHistory`.
2. The Creator can publish it; it becomes discoverable via the existing
   `GET /rides/discover` (a published ride the creator made appears to other
   users within radius/eligibility).
3. The Creator sees their own rides ("My Rides") with current status and can
   open ride details.
4. The Creator can start (`→ IN_PROGRESS`) and complete (`→ COMPLETED`) their
   ride, each transition recorded with history and the existing notification
   mapping.
5. The Creator can accept/reject join requests from ride details (reusing the
   Phase 3.6/3.15 decision surface).
6. History shows completed rides.
7. Every backend rule remains authoritative: validation errors, business-rule
   errors, and authorization (creator-only actions) are enforced by the
   backend; mobile renders them through `MobileError`/`mobileErrorMessage`.
8. No open decision is resolved; no new default threshold is invented.

## 9. Expected backend changes

- New use cases (application layer, following the Phase 3.2/3.6/3.7 pattern):
  `publishRide` (DRAFT → PUBLISHED), `startRide` (PUBLISHED|CONFIRMED →
  IN_PROGRESS), `completeRide` (IN_PROGRESS → COMPLETED), reusing the Phase 3.1
  state machine, row-locking and transaction conventions, and the Phase 3.8
  notification wiring (creator-visible notifications only where the existing
  mapping already defines them).
- A read path for the creator's rides: list own rides (with status) and single
  ride detail, per `api-boundaries.md` §2 (rides: list, detail). This resolves
  the documented "no single-ride GET" limitation used by the mobile snapshot.
- Creator-only authorization enforced at the application/HTTP boundary for all
  new operations (reusing the Phase 3.9/3.10 auth middleware and identity
  from the established boundary — never caller-supplied IDs).

## 10. Expected mobile changes

- **Create Ride screen:** canonical fields (pickup, destination, date/time,
  seats, pricing type + price within configured range, optional radius) using
  the existing `RideApi.createRide` and the Phase 3.16 location/reference
  helpers for coordinate input.
- **Publish action** on a DRAFT ride.
- **My Rides screen** (creator) listing own rides with status; **ride details**
  reusing the existing screen, adding creator actions (publish/start/complete,
  and accept/reject request decisions).
- **Active Ride** and **Ride History** screens per the canonical screen groups.
- New typed routes in the existing framework-free `routes.ts`/`AppNavigator`
  (no navigation library).
- Deterministic render tests with fakes; no new dependencies.

## 11. Expected database changes

- **None required.** The Phase 2 schema already models `Ride`, statuses,
  `RideStatusHistory`, `RideRequest`, `RideParticipant`, and the lifecycle
  transitions are data-only (status updates + history rows). No migration,
  schema, or seed change is expected. If implementation discovers a schema
  gap, the phase must STOP and report it rather than inventing columns.

## 12. Expected API changes

- Additive routes under the existing `/api/v1/rides` namespace per
  `api-boundaries.md` §2 (publish, start, complete, list, detail), using the
  existing `{ data }` / `{ error }` envelope and error model. No contract
  change to existing endpoints; all existing behavior preserved.

## 13. Testing requirements

- Backend: pure unit tests for the new use cases and domain transitions
  (deterministic, no DB); real-PostgreSQL integration tests for persistence +
  history + notifications (self-cleaning fixtures); real-Express HTTP tests for
  the new routes (validation, authorization, envelope). Follow the existing
  per-phase test conventions.
- Mobile: vitest render tests with typed fakes for create/publish/start/
  complete/my-rides/history, reusing `tests/render.tsx` and `tests/fixtures.ts`
  helpers; no real network.
- Do not weaken or delete any existing test.

## 14. Regression requirements

- Baseline to preserve: backend **701 tests / 56 files**; mobile **225 tests /
  32 files** (Phase 3.16 verified, run twice deterministic).
- After implementation: run backend typecheck/lint/test/build, prisma
  validate, prisma migrate status, db:check; mobile typecheck/lint/test; root
  format:check; expo config --type public.

## 15. Definition of done

1. All in-scope items implemented and tested; all out-of-scope items untouched.
2. No open decision resolved; no new threshold/provider/limit invented.
3. Backend and mobile suites green and never reduced; no migration created
   unless a genuine schema gap is reported and approved.
4. `docs/development/phase-3-17-notes.md` written per the standard structure;
   relevant README updated.
5. Final report confirms: **Phase 3.17 COMPLETE — STOPPED BEFORE PHASE 3.18.**
