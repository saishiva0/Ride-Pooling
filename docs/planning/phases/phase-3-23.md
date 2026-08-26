# Phase 3.23 — Push Notifications

> Status: **COMPLETE**
> Predecessor: Phase 3.22 (complete). Depends on OD-005 (resolved Phase 3.18), OD-008 realtime half (resolved Phase 3.22), and resolves the OD-008 push-provider half.

---

## 0. Status

**COMPLETE.** Phase 3.22 is complete. OD-008's push-provider half is resolved in this phase using Expo Notifications + Expo Push Service. The bulk of the implementation existed from prior work; this phase verified it against the spec, fixed the gaps found (see §21 Known Fixes), added the missing test coverage, and completed the documentation.

---

## 1. Objective

Add push notification delivery as a third channel alongside the existing persisted-notification and Socket.io realtime channels (Phase 3.10/3.22), using Expo Notifications (mobile) and Expo Push Service (delivery), behind a provider-neutral abstraction so FCM/APNs could replace Expo later without touching ride/domain code.

---

## 2. Scope

**In scope:**

- Backend: `DevicePushToken` persistence, provider-neutral `PushNotificationProvider` abstraction, `ExpoPushNotificationProvider`, push dispatch wired into the existing notification-draft pipeline
- Backend: authenticated device-token registration/list/deactivation endpoints
- Mobile: `apps/mobile/src/notifications/` module — permissions, token lifecycle, foreground/background handling, tap routing
- Tests: backend push dispatch, provider, repository, HTTP contract, and ride-operation resilience; mobile permissions, token, handlers, navigation, and auth-lifecycle wiring
- Documentation: OD-008 push-provider resolution, phase spec, dev notes, roadmap, mobile README

**Out of scope (explicit, reiterated from the original phase brief):**

- Chat, payments, admin, analytics
- Offline sync, Redis, Kafka, message queues
- Email/SMS/WhatsApp notifications, marketing campaigns, scheduled notifications
- Notification analytics, advanced notification preferences
- A push-notification settings UI screen
- A "GET single ride for participants" backend endpoint
- Real EAS project creation / `eas.json` (requires an Expo account action outside this repo)
- Phase 3.24+ work

---

## 3. Dependencies

- Phase 3.10: Notification persistence, recipient mapping, content mapping
- Phase 3.18: Phone + OTP authentication (OD-005), bearer sessions, `HttpAuthenticator`
- Phase 3.21: Notification-draft pipeline (`NotificationDraft`, `persistNotificationDrafts`)
- Phase 3.22: Socket.io realtime, `EventPublisher`/`publishDrafts` registry pattern (push mirrors this pattern for dispatch)

---

## 4. Existing Architecture

### Notification Module Structure

```
modules/notification/
  domain/notification-rules.ts                    — supported NotificationType set
  application/notification-mapping.ts              — event → NotificationDraft[] (recipient + content)
  application/notification-content.ts              — type → { title, body }
  application/push-dispatch.ts                      — dispatches drafts to a recipient's active devices
  infrastructure/notification.repository.ts         — Notification persistence
  infrastructure/device-push-token.repository.ts    — DevicePushToken persistence
  infrastructure/push-provider.ts                   — PushNotificationProvider port + normalized failure kinds
  infrastructure/expo-push-provider.ts               — Expo Push Service implementation
  http/notification.controller.ts / .routes.ts       — GET/PATCH notifications
  http/device-token.controller.ts / .routes.ts       — device-token registration/list/deactivation

modules/realtime/
  application/push-publisher.ts                     — PushNotificationDispatcher registry (mirrors EventPublisher)
```

### Delivery Pipeline (three independent channels)

```
Business event
  → recipient resolution (notification-mapping.ts)
  → NotificationDraft[]
  → DB transaction commits (persisted notification — authoritative)
  → publishEvents(drafts)  → Socket.io realtime (best-effort)
  → publishPush(drafts)    → Expo push (best-effort)
```

Both `publishEvents` and `publishPush` run **after** commit, matching the Phase 3.22 rule. Push failure is caught at the dispatch boundary (`dispatchPushNotifications` never rethrows) and, as of this phase, also caught at every use-case call site — see §21.

---

## 5. OD-008 Decision (Push Provider Half, Resolved in This Phase)

See `docs/planning/open-decisions.md` for the full record (already written and verified accurate against the implementation in this phase).

**Summary:**

- Provider: Expo Notifications + Expo Push Service
- Platforms: Android + iOS, Expo SDK 57
- Abstraction: `PushNotificationProvider` (backend) keeps all Expo-specific behavior inside `ExpoPushNotificationProvider` — normalizes `success | invalid-token | provider-unavailable | rate-limited | malformed-request | authentication-failure | unknown`
- Device tokens: `DevicePushToken` model, multiple devices per user, soft-deactivation (not deleted)
- Dispatch: best-effort, per-device, invalid tokens auto-deactivated; a push failure never rolls back or fails the originating ride/request operation
- Mobile: `apps/mobile/src/notifications/` — permission states, token acquisition/registration, foreground/background handling, tap routing to the notifications feed
- Secrets: `EXPO_ACCESS_TOKEN`/`PUSH_ENABLED` are backend-only env vars; never `EXPO_PUBLIC_*`

---

## 6. Backend Changes (This Phase)

Most of the backend implementation already existed. This phase verified it end-to-end and fixed:

1. **Missing migration** — `schema.prisma` had `DevicePushToken` but no migration had ever been generated; the actual dev database was missing the table entirely (confirmed by querying `information_schema.tables`). Generated `20260821162521_phase_3_23_device_push_tokens`.
2. **Response envelope bug** — `device-token.controller.ts` bypassed the project's `sendData()` `{ data: ... }` envelope and hand-rolled `res.json()`/error responses, breaking the contract the mobile client already expected (`listDeviceTokens()` reads `response.data`, which was always `undefined`). Also, the exported Zod schemas were never actually applied via `parseRequest` — an empty/missing token would have reached Prisma instead of failing with a clean 400. Fixed both: all handlers now use `sendData`/`parseRequest`/`NotFoundError`/`AuthorizationError`, matching `notification.controller.ts`.
3. **Broken transaction middleware** — `device-token` routes were mounted behind a custom `createTransactionMiddleware()` that wrapped `prisma.$transaction(async (tx) => { res.locals.tx = tx; await next(); })`. Express's `next()` does not return a promise tied to the downstream handler's completion, so the transaction committed (and closed) before the handler's query ran — every device-token request threw `Transaction API error: Transaction already closed`. None of these endpoints had ever been exercised end-to-end before this phase. Removed the middleware entirely (none of the repository operations need multi-statement atomicity) and pass the shared `prisma` client directly.
4. **Push failures could fail the caller** — `await publishPush?.(outcome.drafts)` was unguarded in all five ride use cases (`accept-ride-request.ts`, `reject-ride-request.ts`, `cancel-ride.ts`, `cancel-ride-request.ts`, `expire-ride.ts`). If the registered push dispatcher ever rejected, the whole operation rejected too — even though the ride/request state had already committed. Confirmed by test, then fixed by wrapping each call in try/catch (log and continue), matching the spec's explicit "push failure must never fail the operation" requirement.
5. Removed dead code in `push-dispatch.ts` (an unused `invalidTokens` accumulation).
6. Documented `PUSH_ENABLED`/`EXPO_ACCESS_TOKEN` in `apps/backend/.env.example` (previously showed stale generic placeholders).

---

## 7. Mobile Changes (This Phase)

Most of the mobile module already existed (`apps/mobile/src/notifications/`, wired into `auth-provider.tsx` and `app-navigator.tsx`). This phase fixed:

1. **`app.json`** had no `expo-notifications` plugin, no `android.package`/`ios.bundleIdentifier`, and no `extra.eas.projectId` placeholder — added all three (a real EAS project id still needs to be set by whoever owns the Expo account; see §18 Limitations).
2. **`token.ts`** imported `expo-constants` as a namespace (`import * as Constants`) and read `Constants.expoConfig`/`Constants.projectId` — neither exists on that namespace shape (the package only has a default export, and `projectId` isn't a property at all on Expo SDK 57's `Constants` type). This was a real, previously-uncaught type error (and a runtime bug: the project id would never resolve). Fixed to `import Constants from 'expo-constants'` and dropped the nonexistent `projectId` fallback.
3. **`navigation.ts`** fabricated `{ id: rideId } as any` to satisfy the `RideDetails` route's `{ ride: RideSummary }` param, which the backend cannot actually supply from a bare push payload (documented limitation: no single-ride GET for the participant flow). Rewrote it to route every notification type to `ROUTES.NOTIFICATIONS` — the existing in-app feed, which already fetches real data and already has the accept/reject actions — removing the type-unsafe cast entirely.
4. **`index.ts`** cleanup: removed a dead `setupAuthListener()` no-op stub, replaced an in-body `require('react')` with a static import, removed a redundant module-level `Notifications.setNotificationHandler(...)` call superseded by `setupForegroundHandler()`, and removed a redundant single-token deactivate call immediately followed by deactivate-all.
5. **`create-default-auth-dependencies.ts`** used `require('../realtime/realtime-client').unavailableRealtimeClient` — a dynamic CJS `require()` of a relative, extension-less TS path that fails to resolve under Vitest (only `@/` aliases are registered for relative-import resolution in tests). This masked a fully broken test suite: 4 mobile test files crashed at import time under a different bug (see §21) before ever reaching this line; once that bug was fixed, this one surfaced. Converted to a static import (the target module has no circular dependency, unlike the concrete socket client, which stays dynamic).
6. **Test infrastructure**: added `expo-notifications`/`expo-device`/`expo-constants` fail-closed mocks under `tests/mocks/`, aliased in `vitest.config.ts` — fixing a suite-wide crash (`ReferenceError: __DEV__ is not defined`) that broke 4 unrelated test files (`auth-provider.test.tsx`, `auth-navigator.test.tsx`, `otp-verification-screen.test.tsx`, `phone-entry-screen.test.tsx`) every time they transitively imported the notifications module.

---

## 8. Device-Token Data Model

```prisma
model DevicePushToken {
  id         String   @id @default(cuid())
  userId     String
  token      String   @unique
  platform   String   // "android" | "ios", validated in application code
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  lastSeenAt DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id])

  @@unique([userId, token])
  @@index([userId])
  @@index([userId, isActive])
}
```

Soft-deactivation (`isActive = false`) preserves history instead of deleting rows. Multiple active devices per user are supported.

---

## 9. API Contracts

All under `/api/v1/notifications/device-tokens`, all `requireAuth`-gated, all responses `{ data: ... }` (or `{ error: ... }`):

| Method | Path                    | Body / Params                             | Success                                            |
| ------ | ----------------------- | ----------------------------------------- | -------------------------------------------------- |
| POST   | `/device-tokens`        | `{ token, platform: 'android' \| 'ios' }` | 201, the token row                                 |
| GET    | `/device-tokens`        | —                                         | 200, the caller's token rows                       |
| DELETE | `/device-tokens/:token` | —                                         | 204 (403 if owned by another user, 404 if unknown) |
| DELETE | `/device-tokens`        | —                                         | 200, `{ deactivatedCount }`                        |

The recipient is always `getAuthenticatedUser(res).userId` — never a body/query field. A test explicitly proves a client-supplied `userId`/`recipientId` in the body is ignored.

---

## 10. Token Lifecycle

- **Registration**: `permissions.ts` (granted, not re-prompted after denial) → `token.ts#getExpoPushToken` → `POST /device-tokens`. Upsert on `[userId, token]` — idempotent, reactivates a previously-deactivated token.
- **Auth lifecycle**: `useNotificationsAuth()` subscribes to `AuthProvider.onStateChange`; registers on `authenticated`, deactivates all on `unauthenticated`.
- **Logout**: `deactivateCurrentDeviceTokens()` is best-effort (caught internally) — logout always succeeds even if the backend call fails.
- **Invalid token**: `dispatchPushNotifications` deactivates a token the moment Expo reports `invalid-token` (`DeviceNotRegistered`).

---

## 11. Push Dispatch

Wired into all five ride/request use cases that already produce `NotificationDraft`s (`accept-ride-request.ts`, `reject-ride-request.ts`, `cancel-ride.ts`, `cancel-ride-request.ts`, `expire-ride.ts`) via the `PushNotificationDispatcher` registry (`realtime/application/push-publisher.ts`), gated behind `PUSH_ENABLED` at server startup. Per notification: fetch the recipient's active tokens, send to each (`Promise.allSettled`), deactivate on `invalid-token`, continue on any other failure. Zero active tokens is a no-op.

---

## 12. Foreground / Background / Tap Routing

- **Foreground**: `setupForegroundHandler()` shows the alert without creating a duplicate local record — the persisted notification is already authoritative.
- **Background**: delivered by the OS via Expo Push Service; no app code required.
- **Tap**: every notification type routes to `ROUTES.NOTIFICATIONS` (see §7.3) — malformed/unrecognized payloads are logged and still routed there safely, never crash.

---

## 13. Security

- Device-token endpoints: authenticated, ownership-scoped (403 on cross-user deactivation, 404 on unknown token), recipient never client-supplied
- Push payload: `{ type, rideId?, requestId? }` only — no tokens, secrets, PII, or stack traces
- Backend-only secrets: `EXPO_ACCESS_TOKEN` is never `EXPO_PUBLIC_*`
- No raw provider errors reach the client — `PushFailureKind` normalizes everything

---

## 14. Configuration

Backend (`apps/backend/.env.example`):

```
PUSH_ENABLED=false
EXPO_ACCESS_TOKEN=
```

Mobile: no new `EXPO_PUBLIC_*` variable — the push token flow uses `app.json`'s `extra.eas.projectId` (currently a placeholder; see §18).

---

## 15. Testing

### Backend (new this phase)

- `device-push-token.repository.test.ts` — register/upsert, duplicate, reactivate, multi-device, deactivate one/all, platform validation
- `push-dispatch.test.ts` — successful send, invalid-token deactivation, non-invalid-token failures leave the token active, multi-device partial failure, zero-token no-op, per-recipient independence, never throws on an unexpected rejection
- `expo-push-provider.test.ts` — malformed-token short circuit, every `PushFailureKind` mapping, network-error → `provider-unavailable`
- `device-token.http.integration.test.ts` — registration (201), idempotent duplicate, list (owner-scoped), deactivate own (204), deactivate another's (403), deactivate unknown (404), deactivate-all, invalid platform/empty token (400), unauthenticated (401), client-supplied recipient ignored
- Extended `ride-notification.integration.test.ts` — a rejecting push dispatcher never fails `acceptRideRequest`; the persisted notification still exists

### Mobile (new this phase)

- `permissions.test.ts` — status mapping, `shouldRequestPermission` only true when unknown, fail-closed on native error
- `token.test.ts` — no-device guard, successful acquisition, registration success/failure, deactivate-one/all failure-tolerance, list success/failure
- `handlers.test.ts` — foreground handler shape, subscribe/unsubscribe, tap → navigation delegation, cold-start response, cleanup
- `navigation.test.ts` — every `NotificationType` (and unknown types) routes to the notifications feed; malformed-payload validation; never throws even if the navigator itself throws
- `index.test.ts` — permission-gated registration, backend-failure tolerance, `useNotificationsAuth` registers on `authenticated` / deactivates on `unauthenticated` / unsubscribes on unmount (rendered via `react-test-renderer`, auth-provider mocked)

None of these tests contact Expo's servers or a real device — `expo-notifications`/`expo-device`/`expo-constants` are aliased to fail-closed mocks in `vitest.config.ts`.

---

## 16. Quality Gates

All pass:

- Backend: `typecheck`, `lint`, `test` (948/949 — see §20), `build`
- Mobile: `typecheck`, `lint`, `test` ×2 (411/412 each run — see §20)
- Repository: `format:check` (scoped to files touched this phase — see §20)
- Database: `prisma validate`, `prisma migrate status`, `db:check`
- Expo: `expo config --type public` resolves cleanly with the new plugin/bundle-id config

---

## 17. Out of Scope (Reiterated)

Chat, payments, admin, analytics, offline sync, Redis/Kafka/message queues, email/SMS/WhatsApp notifications, marketing campaigns, scheduled notifications, notification analytics, advanced notification preferences, a push settings UI screen, a new GET-single-ride-for-participants endpoint, real EAS project/build setup, Phase 3.24+.

---

## 18. Limitations (V1)

- `app.json`'s `extra.eas.projectId` is a placeholder (`REPLACE_WITH_EAS_PROJECT_ID`) — a real push token cannot be obtained until an actual EAS project is linked. This requires an Expo account action outside this repository/session.
- No `eas.json` / build profiles were added (same reason).
- The Expo provider sends one HTTP request per device token rather than batching multiple tokens into Expo's chunked `sendPushNotificationsAsync` call — acceptable for V1 volume, a straightforward optimization later.
- `auth-provider.tsx`'s `signOut()` calls `deactivateCurrentDeviceTokens()` directly, and the `useNotificationsAuth()` hook (used by `app-navigator.tsx`) also calls it via the `onStateChange('unauthenticated')` path — every sign-out issues the deactivate-all request twice. Harmless (idempotent) but redundant; left as-is since removing either call site is a design decision (which module owns this responsibility) rather than a bug fix.
- No push-notification settings/permission-status UI screen.

---

## 19. Acceptance Criteria

- [x] OD-008 push-provider half resolved and documented in `open-decisions.md` (already accurate; verified against the fixed implementation)
- [x] Expo Notifications + Expo Push Service selected
- [x] Android + iOS supported (`app.json` plugin, bundle ids)
- [x] `DevicePushToken` persistence implemented, migration generated and applied
- [x] Multiple devices per user supported
- [x] Authenticated registration implemented, ownership-scoped
- [x] Token deactivation (one, all) implemented
- [x] Token lifecycle (register on auth, deactivate on logout, reactivate on re-register) implemented
- [x] `PushNotificationProvider` abstraction + `ExpoPushNotificationProvider` implemented
- [x] Existing notification flow triggers push (all 5 ride/request use cases)
- [x] Push failure cannot break ride operations (fixed and tested this phase)
- [x] Invalid tokens are auto-deactivated
- [x] Foreground/background behavior implemented
- [x] Notification tap routing implemented (safe fallback, no fabricated data)
- [x] Socket.io preserved (untouched)
- [x] In-app notifications preserved (untouched)
- [x] Recipient remains backend-controlled (tested)
- [x] No secrets/tokens/PII logged
- [x] Backend tests pass (948/949 — 1 pre-existing, unrelated failure, see §20)
- [x] Mobile tests pass ×2 (411/412 each — 1 pre-existing, unrelated flaky failure, see §20)
- [x] Backend typecheck/lint/build pass
- [x] Mobile typecheck/lint pass
- [x] Prisma validation passes
- [x] Migration status clean
- [x] Database check passes
- [x] Expo config resolves
- [x] Format check passes (files touched this phase)
- [x] Documentation complete
- [x] Phase 3.24 NOT started

---

## 20. Pre-Existing, Unrelated Findings (Not Fixed — Out of Scope)

Found while verifying this phase; explicitly not touched because they are unrelated to push notifications and fixing them would require decisions/scope this phase doesn't own:

1. **`request-cancellation.integration.test.ts`** — "reverts CONFIRMED → PUBLISHED when the last participant cancels, with history" expects exactly 1 `RideStatusHistory` row but finds 2 (the initial PUBLISHED→CONFIRMED transition on accept is also being logged). A Ride Engine (Phase 3.7/3.21) history-logging bug, not touched by this phase's changes.
   - **Resolved in Phase 3.24 (2026-08-25): this was a wrong assertion, not a bug.** The test's own fixture accepts a request before cancelling, so two transitions are correct and required by `docs/domain/ride-lifecycle.md`. The assertion was corrected; no production code changed. See `docs/development/phase-3-24-notes.md` §3A.
2. **`location-search.test.tsx`** — "renders a normalized error message on provider failure" passes in isolation but fails intermittently when the full mobile suite runs (timing/isolation issue in the debounce test, Phase 3.20). Not caused by this phase's files.
   - **Did not reproduce in Phase 3.24's full-suite runs** (444/444 passing). Left as-is; no fix applied.

## 21. Known Fixes Applied Beyond the Original Gap List

Two defects were found only by writing and running the tests this phase requires (i.e., they were previously completely untested):

- The device-token transaction middleware bug (§6.3) — every device-token HTTP request was broken.
- The unguarded `publishPush` call in all five ride use cases (§6.4) — a rejecting push dispatcher could fail an otherwise-successful ride/request operation, violating the explicit "push must never break the business operation" requirement.

Both are fixed and covered by new tests (§15).
