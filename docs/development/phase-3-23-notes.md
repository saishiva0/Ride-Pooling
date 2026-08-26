# Phase 3.23 — Push Notifications: Implementation Notes

> Status: Phase 3.23 — Complete
> Date: 2026-08-21
> Resolves: OD-008 (push-provider half; the realtime half was resolved in Phase 3.22)

---

## 1. Objective

Add Expo push notifications as a third delivery channel alongside the existing persisted-notification and Socket.io realtime channels, behind a provider-neutral abstraction.

---

## 2. Discovery Summary

Before writing any code, a discovery pass across the planning docs, architecture docs, and both `apps/backend` and `apps/mobile` source found that **most of Phase 3.23 already existed** — apparently built in a prior session, since `docs/planning/open-decisions.md` already carried a fully-written OD-008 push-provider resolution and both apps already had substantial Expo-based implementations wired into the app (`apps/backend/src/modules/notification/{application,infrastructure,http}/*push*`, `apps/backend/src/modules/realtime/application/push-publisher.ts`, and all six files of `apps/mobile/src/notifications/`, already imported from `auth-provider.tsx` and `app-navigator.tsx`).

Given that, this phase's actual work was **verification and hardening**, not greenfield implementation: read every relevant file, cross-check it against the original phase brief and this repo's existing conventions, and fix what didn't hold up. Four categories of gap were found, three of them only by actually running the code (nothing had ever been exercised end-to-end before):

### A. Schema drift with no migration

`schema.prisma` had the `DevicePushToken` model, but `apps/backend/prisma/migrations/` only had two migrations (`phase2_domain_model`, `phase_3_18_auth_sessions`) — neither mentions `DevicePushToken`. Querying `information_schema.tables` on the actual dev database confirmed the table plainly did not exist. `prisma migrate status` reported "up to date" regardless, because it only compares the applied-migrations ledger, not a live schema diff — it does not catch this class of drift. Fixed by generating `20260821162521_phase_3_23_device_push_tokens`.

### B. Device-token HTTP layer was completely broken

Three separate bugs compounded so that **no device-token endpoint had ever worked**:

1. `device-token.controller.ts` bypassed `sendData()` (the project's only sanctioned success-envelope helper) and hand-rolled `res.json()`/error bodies instead — breaking the `{ data: ... }` contract the mobile `token.ts#listDeviceTokens` already expected.
2. The exported Zod schemas (`registerDeviceTokenSchema`, `deactivateDeviceTokenSchema`) were defined but never actually run through `parseRequest` — and were shaped wrong for it anyway (wrapped in `{ body: ... }`/`{ params: ... }` instead of the flat shape `parseRequest` expects).
3. The device-token router was mounted behind a custom `createTransactionMiddleware()` (`prisma.$transaction(async (tx) => { res.locals.tx = tx; await next(); })`). Express's `next()` doesn't return a promise that resolves when the downstream handler finishes — it just invokes the next middleware and returns. So the transaction committed (and closed) almost immediately, before the actual route handler's query ran. Every request failed with `Transaction API error: Transaction already closed`.

None of this was caught earlier because there was zero test coverage for any push-related file. Writing the first integration test (`device-token.http.integration.test.ts`) surfaced bug #3 immediately as a 500 on the very first request. Fixed all three: handlers now use `sendData`/`parseRequest`/`NotFoundError`/`AuthorizationError` like every other controller in the codebase, and the transaction middleware was deleted outright (none of these repository calls need multi-statement atomicity — each is already a single atomic Prisma operation).

### C. Push failure could fail a ride operation

`accept-ride-request.ts`, `reject-ride-request.ts`, `cancel-ride.ts`, `cancel-ride-request.ts`, and `expire-ride.ts` all called `await publishPush?.(outcome.drafts)` with no try/catch, after the transaction had already committed. Confirmed by test: registering a push dispatcher whose `.dispatch()` rejects made `acceptRideRequest` itself reject, even though the ride/request state change had already succeeded — directly violating "push failure must never fail the operation." Fixed by wrapping the call in try/catch (log, continue) in all five files.

### D. Mobile: a real type error, a real runtime bug, and a suite-wide test crash

1. `token.ts` did `import * as Constants from 'expo-constants'` and read `Constants.expoConfig`/`Constants.projectId`. Neither exists on that namespace — `expo-constants` only has a default export, and `projectId` isn't even a property of the `Constants` type on Expo SDK 57 (it's superseded by `expoConfig.extra.eas.projectId`). This was a genuine, previously-uncaught `tsc` error and a runtime bug (the project id would never resolve). Fixed to a default import and dropped the nonexistent fallback.
2. `navigation.ts` cast `{ id: rideId } as any` into the `RideDetails` route's required `{ ride: RideSummary }` param — a snapshot the backend cannot supply from a bare push payload (the app's own documented limitation: no single-ride GET for participants). Rewrote it to route every notification type to `ROUTES.NOTIFICATIONS`, which needs no params and already renders real data.
3. `vitest.config.ts` had no alias for `expo-notifications`/`expo-device`/`expo-constants`. Importing them for real under plain Node throws `ReferenceError: __DEV__ is not defined` — and four unrelated test files (`auth-provider.test.tsx`, `auth-navigator.test.tsx`, `otp-verification-screen.test.tsx`, `phone-entry-screen.test.tsx`) transitively import the notifications module, so the entire mobile suite had four broken files before this phase touched anything. Added fail-closed mocks under `tests/mocks/` (matching the existing `expo-secure-store.ts`/`expo-location.ts` pattern) and aliased them.
4. Fixing (3) exposed a _second_, previously-masked bug: `create-default-auth-dependencies.ts` used `require('../realtime/realtime-client').unavailableRealtimeClient` — a CJS `require()` of a relative, extension-less path that Vitest's module resolution (only `@/` aliases are registered for transitive imports) cannot resolve. This line was never reached before because the four files above crashed at import time first. Converted to a static import (the target has no circular-dependency risk, unlike the concrete socket client, which stays dynamic on purpose).

---

## 3. What Was Actually New Work (Not a Fix)

- The migration itself (§2A).
- All backend push-related tests: `push-dispatch.test.ts`, `expo-push-provider.test.ts`, `device-push-token.repository.test.ts`, `device-token.http.integration.test.ts`, plus the push-resilience case added to `ride-notification.integration.test.ts`.
- All mobile notification-module tests: `permissions.test.ts`, `token.test.ts`, `handlers.test.ts`, `navigation.test.ts`, `index.test.ts`.
- `app.json`: `expo-notifications` plugin, `android.package`/`ios.bundleIdentifier`, `extra.eas.projectId` placeholder — none of these existed for any plugin before.
- `apps/backend/.env.example` documentation for `PUSH_ENABLED`/`EXPO_ACCESS_TOKEN`.

---

## 4. Verification Performed

- Backend: `typecheck`, `lint`, `test` (949 tests, 948 passing — see below), `build`; `prisma validate`, `prisma migrate status`, `db:check` all clean against a real local Postgres.
- Mobile: `typecheck`, `lint`, `test` run twice (412 tests, 411 passing each run — see below); `npx expo config --type public` resolves with the new plugin config.
- `pnpm format:check` (scoped to files touched this phase; the wider repo has pre-existing formatting debt unrelated to this phase — see phase spec §16).

Two pre-existing, unrelated failures were found and deliberately left alone (documented in `docs/planning/phases/phase-3-23.md` §20):

- A Ride Engine history-logging bug (`request-cancellation.integration.test.ts`, expects 1 `RideStatusHistory` row, gets 2) — Phase 3.7/3.21 code, untouched by this phase.
- A timing/isolation flake in `location-search.test.tsx` that only reproduces under the full suite, never in isolation — Phase 3.20 code, untouched by this phase.

---

## 5. Known Limitation Carried Forward

`app.json`'s `extra.eas.projectId` is a placeholder (`REPLACE_WITH_EAS_PROJECT_ID`). Real push tokens cannot be obtained until an actual EAS project is linked — that requires an Expo account action outside this repository. Everything else (backend dispatch, device-token API, mobile registration/lifecycle/routing) is real, tested, and ready for that project id once it exists.
