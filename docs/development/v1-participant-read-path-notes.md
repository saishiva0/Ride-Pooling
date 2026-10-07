# V1 Rider Read Path — Participant Persistence: Implementation Notes

> Status: V1 rider read path — Complete
> Date: 2026-10-05
> Branch: `feat/v1-participant-read-path`
> Resolves: nothing new. **OD-010, OD-013, OD-002, OD-003, OD-012 and OD-018
> remain OPEN/unresolved** and untouched. No identity verification, payment,
> offline sync, or chat scope was introduced or modified.

---

## 1. Objective

Close the independent V1 rider-read gap: participant request results were
session-local, My Requests was lost after an app restart, there was no
persisted participant "my requests" API, and there was no participant-side
read path for joined/confirmed rides. `GET /rides/:rideId` was
creator-authorized only.

The V1 DoD requires: a participant sees the request result, a confirmed
participant sees the ride, and a user can view ride history
(`docs/planning/v1-definition-of-done.md` §1.13/§1.14/§1.18).

---

## 2. Discovery Summary

A discovery pass before coding confirmed:

- **RideRequest** already persists the full lifecycle status
  (`PENDING`/`ACCEPTED`/`REJECTED`/`CANCELLED`) with `createdAt`/`resolvedAt`
  (`schema.prisma`), and **RideParticipant** persists confirmed membership
  (`CONFIRMED`/`CANCELLED`, `seatsAllocated`). No new lifecycle states or
  tables were needed.
- **Creator reads:** `list-creator-rides.ts` (`GET /rides/mine`) and
  `get-ride-detail.ts` (`GET /rides/:rideId`) sharing `creator-ride-read.ts`
  and the `CreatorRide` shape (created ride + live `availableSeats`).
- **Mobile request store** (`request-store.ts`) was explicitly session-local
  and the only (non-authoritative) source for My Requests; it reset on restart.
- **Notifications/realtime** already emit the canonical request lifecycle
  events (`RIDE_REQUESTED`, `REQUEST_ACCEPTED`, `REQUEST_REJECTED`,
  `REQUEST_CANCELLED`, `RIDE_CONFIRMED`); nothing new was needed. REST remains
  the authoritative recovery path (OD-008).

No requirement depended on an unresolved open decision, so implementation
proceeded without a stop condition.

---

## 3. What Was Implemented

### A. Backend — participant read path

- **Repository** (`infrastructure/ride.repository.ts`): read-only
  `listParticipantRideRequests`, `listConfirmedParticipantRides`,
  `hasConfirmedParticipation`, plus a shared `confirmedSeatsByRideId` helper.
  All reuse the existing seat formula and `RIDE_WITH_RELATIONS`.
- **Application** (`application/participant-ride-read.ts`):
  `ParticipantRideRequest` shape, mapping via the existing `toCreatorRide` (no
  duplicated DTO), and default transaction wiring.
- **Use cases:**
  - `list-my-ride-requests.ts` → `GET /api/v1/rides/requests/mine`
    (the authenticated participant's own requests, oldest first, with ride
    summary, creator, pickup/destination, ride status, available seats, and
    the request's own status/timestamps).
  - `list-joined-rides.ts` → `GET /api/v1/rides/joined` (rides where the
    authenticated user is a CONFIRMED participant, departure ascending).
- **Ride detail authorization** (`get-ride-detail.ts`): the creator check was
  **not** removed. The authorization rule was extended to an explicit
  `actor is creator OR has a CONFIRMED participation` rule, evaluated inside
  one transaction. Missing rides still return `NotFoundError` (404); foreign
  rides still return `AuthorizationError` (403) — creator behavior unchanged.
- **HTTP** (`ride.routes.ts`/`ride.controller.ts`): new authenticated GET
  routes registered before `/rides/:rideId`; no `userId` is accepted from the
  client — identity always comes from `getAuthenticatedUser`.

No global creator authorization was weakened.

### B. Mobile — server-authoritative reads

- **`RideApi`**: `listMyRequests()` and `listJoinedRides()`, plus wire DTOs,
  domain types (`ParticipantRideRequest`, `MyRideRequest`), and pure mappers.
- **My Requests** (`my-requests-screen.tsx`): loads from
  `GET /rides/requests/mine` on screen load with loading/error/empty states
  via the existing `useAsync`/`MobileError` patterns, so it survives an app
  restart. The Phase 3.21 Withdraw / Cancel participation actions are
  preserved and reload the server state after success. The in-memory
  `request-store.ts` is no longer authoritative and is no longer wired into
  the navigator (retained as an optional, documented cache).
- **Participant ride visibility:** the navigator no longer owns a request
  store; `RideHistoryScreen` now merges `listMyRides()` and
  `listJoinedRides()` (de-duplicated by ride id) so a confirmed participant's
  completed joined rides appear in history. A joined ride can be reopened via
  the server-authorized `getRideDetail`.
- **`GET /rides/:rideId`** is the same typed method for creator and confirmed
  participant.

### C. Notifications / realtime

No new event types. Existing request-lifecycle events are reused; REST is the
authoritative recovery path. No outbox/replay was introduced.

---

## 4. Files Changed

| File                                                                           | Change                                         |
| ------------------------------------------------------------------------------ | ---------------------------------------------- |
| `apps/backend/src/modules/ride/infrastructure/ride.repository.ts`              | Participant read queries + membership check    |
| `apps/backend/src/modules/ride/application/participant-ride-read.ts`           | New shared participant read plumbing           |
| `apps/backend/src/modules/ride/application/list-my-ride-requests.ts`           | New use case                                   |
| `apps/backend/src/modules/ride/application/list-joined-rides.ts`               | New use case                                   |
| `apps/backend/src/modules/ride/application/creator-ride-read.ts`               | Add membership check to the read port          |
| `apps/backend/src/modules/ride/application/get-ride-detail.ts`                 | Creator OR confirmed-participant authorization |
| `apps/backend/src/modules/ride/http/ride.controller.ts`                        | Two new handlers                               |
| `apps/backend/src/modules/ride/http/ride.routes.ts`                            | Two new authenticated GET routes               |
| `apps/backend/src/modules/ride/application/creator-ride-read.test.ts`          | Participant access cases                       |
| `apps/backend/src/modules/ride/application/participant-ride-read.test.ts`      | New unit tests                                 |
| `apps/backend/src/modules/ride/http/ride.participant.http.integration.test.ts` | New HTTP integration tests                     |
| `apps/mobile/src/ride/api.types.ts`                                            | Participant request DTOs                       |
| `apps/mobile/src/ride/types.ts`                                                | `MyRideRequest`, `ParticipantRideRequest`      |
| `apps/mobile/src/ride/mappers.ts`                                              | `mapParticipantRideRequest`                    |
| `apps/mobile/src/ride/api.ts`                                                  | `listMyRequests`, `listJoinedRides`            |
| `apps/mobile/src/screens/requests/my-requests-screen.tsx`                      | Server-authoritative load                      |
| `apps/mobile/src/screens/rides/ride-history-screen.tsx`                        | Merge creator + joined history                 |
| `apps/mobile/src/navigation/app-navigator.tsx`                                 | Remove authoritative request store wiring      |
| `apps/mobile/src/ride/request-store.ts`                                        | Documented as non-authoritative cache          |
| `apps/mobile/tests/fixtures.ts`                                                | New DTO/model + API fakes                      |
| `apps/mobile/src/ride/api.test.ts`                                             | New API method tests                           |
| `apps/mobile/src/ride/mappers.test.ts`                                         | New mapper tests                               |
| `apps/mobile/src/screens/requests/my-requests-screen.test.tsx`                 | Rewritten server-authoritative tests           |
| `apps/mobile/src/screens/rides/ride-history-screen.test.tsx`                   | Joined-history test                            |
| `apps/mobile/README.md`                                                        | Request-state row reconciled                   |
| `apps/backend/src/modules/ride/README.md`                                      | Participant read path documented               |

---

## 5. Database

**No schema change.** No `schema.prisma` edit and no new migration. The
existing `RideRequest`, `RideParticipant`, `Ride`, `Location`, and `User`
structures already express the required relationships (a request belongs to a
user and targets a ride; a participant references both). No new table was
created.

---

## 6. API Changes

Two additive authenticated endpoints; no contract change to existing routes:

- `GET /api/v1/rides/requests/mine` → `ParticipantRideRequest[]`
- `GET /api/v1/rides/joined` → `CreatorRide[]` (reuses the existing shape)

`GET /api/v1/rides/:rideId` now serves the creator or a CONFIRMED
participant; the response shape is unchanged.

---

## 7. Tests

Backend:

- Participant read unit tests (`participant-ride-read.test.ts`): mapping,
  empty results, malformed-input rejection.
- Creator read tests extended for the participant rule (confirmed access +
  non-participant 403).
- New HTTP integration suite (`ride.participant.http.integration.test.ts`):
  own-requests scoping, another user cannot retrieve them, persisted status
  returned, confirmed participant reads joined ride, unrelated user 403,
  unconfirmed 403, creator unchanged, participant history persisted,
  canonical 404/401.

Mobile:

- `RideApi` request/joined methods; mapper tests; My Requests loading/error/
  empty/persisted-after-remount; withdraw/cancel reload; history includes
  joined rides; creator flow tests untouched.

No existing test was weakened or deleted.

---

## 8. Verification Results

Run with the repository's own scripts against the local dev PostgreSQL
(`pnpm db:start`).

| Gate                                                        | Result                                    |
| ----------------------------------------------------------- | ----------------------------------------- |
| Backend `typecheck`                                         | Pass                                      |
| Backend `test`                                              | **92 files / 1060 tests pass** (was 1040) |
| Backend `build`                                             | Pass                                      |
| Mobile `typecheck`                                          | Pass                                      |
| Mobile `test`                                               | **62 files / 481 tests pass** (was 472)   |
| Root `format:check`                                         | Pass                                      |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` | Pass                                      |
| `git diff --check`                                          | Clean                                     |

Prisma: no schema change; `prisma validate` / `prisma migrate status` and
`db:check` run as part of the gates where available. The only unapplied
migration remains the pre-existing Phase 3.25 chat migration (unrelated).

---

## 9. Open Decisions Deliberately Left Untouched

- **OD-010 (identity verification):** OPEN — no verification behavior added.
- **OD-013 (data retention):** OPEN — history reuses existing reads only.
- **OD-002 (cancellation windows):** OPEN — existing cancel behavior reused.
- **OD-003 (vehicle types):** OPEN — unchanged.
- **OD-012 (post-publication editing):** OPEN — no edit policy added.
- **OD-018 (rounding):** OPEN — existing formatting reused.
- OD-004/005/007/008/009 remain RESOLVED and were reused as-is.

No identity verification, payment, offline sync, or chat scope changes were
made.

---

## 10. V1 Blocker

Resolved: participant read path implemented as server-authoritative My
Requests, participant joined-ride visibility, and participant ride history.
OD-010 remains OPEN and was explicitly not implemented.
