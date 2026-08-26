# Phase 3.21 Notes — Request & Participant Lifecycle Completion

**Status:** COMPLETE
**Date:** 2026-08-20
**Deferred:** OD-002 (time-based cancellation windows/grace periods — remains OPEN)

---

## Summary

Phase 3.21 completes the request/participant lifecycle (`docs/domain/ride-lifecycle.md`
§4.2/§4.3/§6). The requester can now withdraw a PENDING request and cancel an ACCEPTED
participation through a single canonical endpoint
`POST /api/v1/rides/:rideId/requests/:requestId/cancel`:

- **PENDING withdrawal** → request CANCELLED; ride unchanged; no seats released.
- **ACCEPTED participation cancellation** → participant CANCELLED + `cancelledAt`
  (seat freed); request CANCELLED; when the last confirmed participant cancels, the
  ride reverts CONFIRMED → PUBLISHED with a `RideStatusHistory` row.
- **IN_PROGRESS rides** → participation cancellation NOT permitted (OD-011 →
  BusinessRuleError), matching Phase 3.7's creation-time rule.
- Only the request owner (requester/participant) may cancel; the creator gets an
  AuthorizationError (request ownership is private to the participant).

No Prisma schema change. Seat availability is derived purely from CONFIRMED
participants, so a cancellation frees seats with no new counting logic. The backend
publishes a REQUEST_CANCELLED notification (to the ride creator only) and a
`REQUEST_CANCELLED` realtime event; the mobile app mirrors the realtime event and
adds participant-facing Withdraw/Cancel actions on My Requests.

**OD-002 remains OPEN** (by decision): only canonical state-based rules are
implemented; no time window or grace period was invented. This matches the Phase 3.5 /
3.7 pattern of not fabricating product policy.

---

## Changes by Layer

### Canonical Documentation

- `docs/development/phase-3-21-notes.md`: This document
- `docs/planning/open-decisions.md`: OD-002 re-annotated as still OPEN with a note
  that Phase 3.21 did not invent a time window
- `apps/mobile/README.md`: Phase badge + boundaries/config/testing updates

### Backend (`apps/backend`)

**Domain rules (new):**

- `src/modules/ride/domain/request-cancellation-rules.ts` — pure predicates
  `isWithdrawableRequest`, `isCancellableParticipation`, `shouldRevertToPublished`
  (single source of truth for the §4.2 cancellation policy)

**Repository (`src/modules/ride/infrastructure/ride.repository.ts`):**

- `CancelableParticipantRow`, `findParticipantForCancellation` (returns id, userId,
  seatsAllocated, status), `cancelRideParticipant` (sets status CANCELLED +
  `cancelledAt`), `classifyRideCancellationError` (P2025 → not_found, P2003 →
  foreign_key)

**Application:**

- `src/modules/ride/application/ride-request-cancellation.ts` — plumbing
  (`RideRequestCancellationInput`, `RideRequestCancellationPersistence`,
  `RideRequestCancellationDependencies`, `assertValidCancellationInput`,
  `createRideRequestCancellationPersistence`, `defaultRideRequestCancellationDependencies`)
- `src/modules/ride/application/cancel-ride-request.ts` — `cancelRideRequest` returns
  `CancelledRideRequest` `{ requestId, requestStatus, rideId, participantId |
null, participantStatus | null, releasedSeats, rideStatus, rideStatusChanged,
cancelledAt }`. Persistence runs in one `$transaction` (Phase 3.6 ride row lock),
  notification drafts are persisted in the same transaction, and realtime
  `publishDrafts` runs only after commit. The last-participant revert uses
  `LAST_PARTICIPANT_CANCELLED_REASON = 'Last confirmed participant cancelled'` and the
  existing `countConfirmedParticipantSeats(...) === 0` invariant.

**Notification module:**

- `REQUEST_CANCELLED` added to `SUPPORTED_NOTIFICATION_TYPES` (now 7); content
  case (title `Ride request cancelled`, body `A participant cancelled their ride
request`); `requestCancelledDrafts` maps it to the ride creator only (the
  participant already knows).

**Realtime:**

- `REQUEST_CANCELLED` added to backend `REALTIME_EVENT_TYPES` (now 7).

**HTTP:**

- `cancelRideRequestHandler` in `ride.controller.ts` (uses
  `requestDecisionPathSchema` + `getAuthenticatedUser`, `sendData(res, 200, ...)`);
  route `POST /rides/:rideId/requests/:requestId/cancel` in `ride.routes.ts`.

**Backend tests:**

- New `request-cancellation-rules.test.ts` (10), `cancel-ride-request.test.ts` (18),
  `request-cancellation.integration.test.ts` (7)
- Updated `notification-rules.test.ts`, `notification-content.test.ts`,
  `notification-mapping.test.ts`, `realtime-events.test.ts`, `event-mapping.test.ts`
  for REQUEST_CANCELLED

### Mobile (`apps/mobile`)

**API layer:**

- `src/ride/api.types.ts`: `'REQUEST_CANCELLED'` added to `NotificationTypeValue`;
  new `CancelledRideRequestDto` (mirrors the backend wire shape, ISO date string)
- `src/ride/types.ts`: `CancelledRideRequest` model (parsed `cancelledAt`)
- `src/ride/mappers.ts`: `mapCancelledRideRequest`
- `src/ride/api.ts`: `cancelRequest({ rideId, requestId })` →
  `POST /rides/:rideId/requests/:requestId/cancel` (extended `requestDecisionPath`)

**Realtime:**

- `src/realtime/events.ts`: `'REQUEST_CANCELLED'` added (six → seven), mirroring the
  backend contract; `events.test.ts` pinned to seven

**Screens/navigation:**

- `src/screens/requests/my-requests-screen.tsx`: takes `rideApi` + `onCancelled`
  props; per-card Withdraw (PENDING) / Cancel participation (ACCEPTED) action through
  `useAsync`, with loading/error/confirmation states; no action for REJECTED/CANCELLED
- `src/navigation/app-navigator.tsx`: wires `rideApi` and `onCancelled`, which calls
  `requestStore.updateStatus(requestId, 'CANCELLED')`

**Mobile tests:**

- Updated `realtime/events.test.ts` (seven types), `mappers.test.ts`,
  `my-requests-screen.test.tsx` (withdraw, cancel, no-action), `api.test.ts`
  (cancelRequest path + parsed ACCEPTED cancellation)
- `tests/fixtures.ts`: `cancelledRideRequestDto` factory + `fakeRideApi.cancelRequest`

---

## Test Results

**Backend:** 73 test files — **693 passed / 201 failed**, 54 files passed / 19
failed. All failures are real-database integration suites requiring PostgreSQL on
`localhost:5433`, which is not running in this environment (documented baseline; the
new `request-cancellation.integration.test.ts` is in that set). No unit-test
regressions.

**Mobile:** 47 test files, **343 passed** (baseline 336 + Phase 3.21 tests; no
existing test removed).

---

## Quality Gates

- ✅ Backend: `lint`, `typecheck` clean
- ✅ Mobile: `lint`, `typecheck`, `test` (343/343)
- ⚠️ Backend integration tests need a running database (environment limitation,
  not a code defect)
- ⚠️ `format:check` for new/changed files follows the Phase 3.20 precedent (two
  historical docs have pre-existing formatting drift and are left untouched)

---

## Notes

- **OD-002 deliberately not resolved:** no time window or grace period was invented;
  only canonical state-based rules are implemented (`request-cancellation-rules.ts`
  documents this). OD-002 stays OPEN in `open-decisions.md`.
- **Single endpoint, authoritative status:** the cancel route branches on the
  request's authoritative status (PENDING → withdraw, ACCEPTED → cancel participation)
  per `docs/architecture/api-boundaries.md` "cancel" verb semantics; the client never
  guesses the branch.
- **Seat release needs no new math:** availability is always derived from CONFIRMED
  participants, so `cancelRideParticipant` (CANCELLED + `cancelledAt`) frees seats
  automatically; `shouldRevertToPublished` reuses `countConfirmedParticipantSeats`
  (no separate participant-count function).
- **IN_PROGRESS is closed to cancellation** (OD-011): restructured the use case so an
  ACCEPTED participation on an IN_PROGRESS ride throws a BusinessRuleError before the
  cancellability guard (an initial test caught the wrong error kind).
- **Ownership privacy:** the creator cannot cancel a request through this route
  (AuthorizationError); REQUEST_CANCELLED notifications go to the creator only.
- **TS narrowing fix:** `resultingRideStatus` needed an explicit `RideStatus` type
  annotation to avoid control-flow narrowing across the last-participant branch.
- **No schema changes, no migrations, no new entities.**

---

## Verification Checklist

- [x] Canonical docs updated (open-decisions OD-002 still OPEN; README)
- [x] PENDING withdrawal → request CANCELLED, ride unchanged (unit-tested)
- [x] ACCEPTED cancellation → participant CANCELLED + releasedSeats, ride unchanged
- [x] Last confirmed participant cancels → ride CONFIRMED → PUBLISHED +
      RideStatusHistory (unit-tested)
- [x] IN_PROGRESS ride → BusinessRuleError (OD-011) (unit-tested)
- [x] Creator cannot cancel another participant's request (AuthorizationError)
- [x] REQUEST_CANCELLED notification → creator only; realtime event (backend + mobile)
- [x] Backend lint/typecheck green; mobile lint/typecheck/test green (343/343)
- [x] No schema changes, no migrations, no new entities
- [ ] Backend integration tests require a running PostgreSQL on `localhost:5433`
      (not available in this environment)
