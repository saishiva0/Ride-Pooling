# Phase 3.17 — Mobile Ride Creator Flow: Implementation Notes

> Status: Phase 3.17 — Complete
> Date: 2026-10-01
> Resolves: nothing new. **OD-012, OD-013, OD-018, OD-002 and OD-003 remain
> OPEN/unresolved** and untouched, exactly as `docs/planning/phases/phase-3-17.md`
> §0/§4 require. **OD-010 (identity verification) remains OPEN.**

---

## 1. Objective

Complete the mobile Creator side of the canonical V1 marketplace loop —
create → publish → my rides → active ride (start/complete) → history — reusing
the existing Ride Engine lifecycle, authorization, notifications, and realtime
behavior without resolving any open decision or introducing new policy.

---

## 2. Discovery Summary

A discovery pass before coding found that **most of Phase 3.17 was already
implemented** in the repository (all of it landed in the initial commit
`8abed08 chore: initialize ride-pooling repository`, and the Phase 3.17 spec
had simply never been reconciled with the code):

### Already present and correct (verified)

- **Backend lifecycle use cases:** `publish-ride.ts` (DRAFT → PUBLISHED),
  `start-ride.ts` (PUBLISHED|CONFIRMED → IN_PROGRESS), `complete-ride.ts`
  (IN_PROGRESS → COMPLETED) — each row-locks the ride, enforces creator
  authorization, delegates to the Phase 3.1 state machine, writes
  `RideStatusHistory`, and creates no notification/realtime event (the existing
  Phase 3.8 mapping has no draft for these transitions).
- **Backend creator reads:** `list-creator-rides.ts` (GET `/rides/mine`) and
  `get-ride-detail.ts` (GET `/rides/:rideId`), sharing `creator-ride-read.ts`
  and the `CreatorRide` shape (created-ride + live `availableSeats`).
- **HTTP wiring:** routes/controller/schema for create, list, detail, publish,
  start, complete; `/rides/mine` registered before `/rides/:rideId`; actor
  identity always from `getAuthenticatedUser` (never the body).
- **Mobile:** `create-ride-screen`, `my-rides-screen`, `active-ride-screen`,
  `ride-history-screen`, creator actions on `ride-details-screen`, typed nav
  routes, and `RideApi` methods `listMyRides`/`getRideDetail`/`publishRide`/
  `startRide`/`completeRide`.

### Gaps found

1. **Functional:** `RideApi.publishRide` existed but was **called by no
   screen**. A DRAFT ride in My Rides routed to Ride Details, whose creator
   section offered only "Cancel ride" — so acceptance criterion 2 (a creator
   can publish a draft) was unreachable from the mobile UI.
2. **Tests:** no mobile tests exercised the creator API methods, and there were
   no render tests for `create-ride-screen`, `my-rides-screen`,
   `active-ride-screen`, or `ride-history-screen` (spec §10 requires tests for
   create, publish, My Rides, start, complete and history).

No requirement depended on an unresolved open decision, so implementation
proceeded without a stop condition.

---

## 3. What Was Implemented This Phase

### A. Publish wired into the mobile creator action screen

- **`apps/mobile/src/screens/rides/active-ride-screen.tsx`** — added a
  `PUBLISHABLE_STATUSES = ['DRAFT']` capability, a `publishRide` operation via
  `useAsync`, a publish confirmation, a "Publish Ride" section/button, and a
  reload (`getRideDetail`) after a successful publish. The "No actions
  available" note now also accounts for `canPublish`.
- **`apps/mobile/src/screens/rides/my-rides-screen.tsx`** — DRAFT rides now
  route to the creator action screen (`ROUTES.ACTIVE_RIDE`) instead of the
  details screen, with a "Manage Ride" label, so the creator can reach Publish.

### B. Tests added

- **`apps/mobile/src/ride/api.test.ts`** — added API-contract tests for
  `listMyRides`, `getRideDetail`, `publishRide`, `startRide`, `completeRide`
  (paths, methods, and date mapping).
- **`apps/mobile/tests/fixtures.ts`** — added `creatorRideDto`,
  `publishedRideDto`, `startedRideDto`, `completedRideDto` wire fixtures.
- **New screen tests:**
  - `create-ride-screen.test.tsx` — field rendering, validation rejection
    without an API call, successful creation with parsed input, navigation to
    My Rides, normalized API error.
  - `my-rides-screen.test.tsx` — empty state, list rendering with status/seats,
    normalized error + retry, and routing for DRAFT/IN_PROGRESS (→ Active Ride),
    COMPLETED (→ History), CANCELLED (→ Details).
  - `active-ride-screen.test.tsx` — publish a DRAFT (+ reload), start a
    PUBLISHED ride, complete an IN_PROGRESS ride, normalized load error +
    retry, and back-navigation to My Rides.
  - `ride-history-screen.test.tsx` — empty state, COMPLETED-only filtering,
    normalized error + retry, navigation to details.

---

## 4. Files Changed

| File                                                         | Change                                         |
| ------------------------------------------------------------ | ---------------------------------------------- |
| `apps/mobile/src/screens/rides/active-ride-screen.tsx`       | Publish action for DRAFT rides                 |
| `apps/mobile/src/screens/rides/my-rides-screen.tsx`          | Route DRAFT rides to the creator action screen |
| `apps/mobile/src/ride/api.test.ts`                           | Creator API method tests                       |
| `apps/mobile/tests/fixtures.ts`                              | Creator/lifecycle wire-DTO fixtures            |
| `apps/mobile/src/screens/rides/create-ride-screen.test.tsx`  | New screen tests                               |
| `apps/mobile/src/screens/rides/my-rides-screen.test.tsx`     | New screen tests                               |
| `apps/mobile/src/screens/rides/active-ride-screen.test.tsx`  | New screen tests                               |
| `apps/mobile/src/screens/rides/ride-history-screen.test.tsx` | New screen tests                               |
| `docs/planning/phases/phase-3-17.md`                         | Status reconciled to IMPLEMENTED               |
| `docs/development/phase-3-17-notes.md`                       | This record                                    |

---

## 5. Database

**No schema change.** No `schema.prisma` edit and no new migration. The existing
`Ride`, `RideStatusHistory`, `RideRequest`, and `RideParticipant` structures
already support the creator flow. (The only unapplied migration on the local
dev database is the pre-existing `20260826150000_phase_3_25_chat` from Phase
3.25 — unrelated to this phase.)

## 6. API Changes

None. All endpoints already existed: `POST /api/v1/rides`,
`GET /api/v1/rides/mine`, `GET /api/v1/rides/:rideId`,
`POST /api/v1/rides/:rideId/publish`, `POST /api/v1/rides/:rideId/start`,
`POST /api/v1/rides/:rideId/complete`, plus the existing accept/reject/cancel
and cancel-ride routes. No contract change.

## 7. Mobile Changes

Publish became reachable (creator action screen + My Rides routing), and four
creator screens gained test coverage. No new dependency, screen, route, or
design-system component was introduced.

## 8. Tests Added / Updated

- Mobile: +4 test files, +26 tests (446 → 472). No existing test was weakened
  or deleted.
- Backend: no changes were required; the creator lifecycle/read/HTTP suites
  already existed and stayed green.

## 9. Verification Results

Run with the repository's own scripts, backed by the local dev PostgreSQL
(`pnpm db:start`).

| Gate                        | Result                                            |
| --------------------------- | ------------------------------------------------- |
| Backend `typecheck`         | Pass                                              |
| Backend `lint`              | Pass                                              |
| Backend `test`              | **90 files / 1040 tests pass**                    |
| Backend `build`             | Pass                                              |
| `prisma validate`           | Pass                                              |
| `prisma migrate status`     | Pass (only pre-existing chat migration unapplied) |
| `db:check`                  | Pass — "Database connection OK"                   |
| Mobile `typecheck`          | Pass                                              |
| Mobile `lint`               | Pass                                              |
| Mobile `test`               | **62 files / 472 tests pass**                     |
| `expo config --type public` | Pass                                              |
| Root `format:check`         | Pass                                              |
| `git diff --check`          | Clean                                             |

## 10. Known Issues

- None caused by this change.
- Pre-existing/local-only: the local dev database had not applied the Phase
  3.25 chat migration (`20260826150000_phase_3_25_chat`) at verification time.
  This is a local environment state, not an application or CI failure — the
  backend integration suite (including chat) passed against the test schema.
- No flaky or unrelated failing test was observed.

## 11. Open Decisions Deliberately Left Untouched

- **OD-010 (identity verification):** OPEN — no verification behavior added.
- **OD-012 (post-publication editing):** OPEN — no edit policy added.
- **OD-013 (data retention):** OPEN — Ride History reuses existing reads only.
- **OD-018 (rounding):** OPEN — existing display formatting reused.
- **OD-002 (cancellation windows):** OPEN — existing cancel behavior reused.
- **OD-003 (vehicle types):** OPEN — `vehicleType` stays optional/unvalidated.
- OD-004/005/007/008/009 remain RESOLVED and were reused as-is; none was
  reopened or modified.

## 12. Boundary

Phase 3.17 is complete. Phase 3.26 (Payments) and Phase 3.27
(Offline/Reliability) remain post-V1 and were **not** implemented.
