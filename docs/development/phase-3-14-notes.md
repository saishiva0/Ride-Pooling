# Phase 3.14 — Mobile Authentication & Identity Boundary: Implementation Notes

> Status: Phase 3.14 — Implementation
> Records the provider-ready identity integration for the mobile application.
> **Actual authentication was not implemented because OD-005 remains
> unresolved.** No credential scheme, provider, token format, session
> persistence, or authentication UI was added, and production authentication
> stays fail-closed. No backend file, database schema, migration, seed, or
> API contract was changed.

## 1. Authentication decision discovered

**OD-005 (authentication method) is OPEN.** No authoritative repository
decision selects an authentication mechanism. Every source that touches the
topic explicitly defers it:

- `docs/planning/open-decisions.md` — OD-005: "Authentication method
  (phone+OTP vs email+password vs magic link)" — OPEN, blocks "Auth module,
  providers".
- `docs/product/product-requirements.md` — FR-001: "Register with a
  phone/email + OTP or password (method = open decision OD-005)".
- `docs/architecture/api-boundaries.md` — "Auth via bearer token (OD-005)".
- `docs/architecture/technical-decisions.md` — no ADR resolves auth; ADR-010
  (stack) remains Proposed.
- `docs/architecture/system-architecture.md` — "Authentication: secure login,
  session/token handling (OD-005)".
- `docs/development/phase-3-9-notes.md` §2, `phase-3-10-notes.md` §5/§14,
  `phase-3-11-notes.md`, `phase-3-12-notes.md`, `phase-3-13-notes.md` §15 —
  all record OD-005 as OPEN; no JWT, OAuth, password, OTP, magic link,
  Firebase, Auth0, Clerk, Supabase Auth, or any other provider is approved.
- `docs/development/environment.md` — `JWT_SECRET` / `JWT_EXPIRES_IN` remain
  inactive placeholders.

Per the phase boundary (§4/§6/§26), no provider was invented and no product
decision was made. The credentials question remains open.

## 2. Authoritative source

`docs/planning/open-decisions.md` (OD-005, OPEN) is the canonical decision
register; the PRD (FR-001) and `docs/architecture/api-boundaries.md` defer to
it. All phase notes agree — there is no conflict to resolve.

## 3. Existing auth architecture (preserved)

- Backend (Phase 3.9/3.10/3.11): `AuthenticatedUser { userId }`,
  `Authenticator` port, `verifyAuthenticatedIdentity`, `HttpAuthenticator`
  (fail-closed default), authorization guards. Unchanged.
- Mobile (Phase 3.13): `AuthClient` port + `unavailableAuthClient` (fail
  closed), `AuthProvider`/`useAuth`, `AuthSession`, `RootNavigator` boundary
  selection. Strengthened here, not replaced.

## 4. Files created

```
apps/mobile/src/auth/errors.ts                  — normalizeAuthError (auth error normalization)
apps/mobile/src/auth/session-restore.ts         — authStateFromSession / authStateFromFailure
apps/mobile/src/auth/auth-headers.ts            — AuthHeadersProvider + noAuthHeadersProvider
apps/mobile/src/screens/restoring-boundary-screen.tsx — deterministic restoring splash
apps/mobile/src/auth/errors.test.ts             — 5 tests
apps/mobile/src/auth/session-restore.test.ts    — 6 tests
apps/mobile/src/auth/auth-headers.test.ts       — 4 tests
apps/mobile/src/auth/types.test.ts              — 7 tests
apps/mobile/src/api/client-auth.test.ts         — 4 tests (API credential propagation)
docs/development/phase-3-14-notes.md            — this document
```

## 5. Files modified

- `apps/mobile/src/auth/types.ts` — added `AuthState` discriminated union
  (restoring / unauthenticated / authenticated / authentication-error),
  extended `AuthStatus`, added `createAuthenticatedUser` /
  `createAuthSession` factories and guards (`isAuthenticatedUser`,
  `isRestoring`, `isUnauthenticated`, `isAuthenticatedState`,
  `isAuthenticationError`). Identity remains exactly `{ userId }`.
- `apps/mobile/src/auth/auth-provider.tsx` — single-source `AuthState`
  state; restore/sign-in failures settle to `authentication-error` with a
  normalized `MobileError`; restore failure now lands in
  `authentication-error` (Phase 3.13 settled it to `unauthenticated`). Context
  exposes `state` plus derived `status` / `session` / `isAuthenticated`.
- `apps/mobile/src/api/client.ts` — `createApiClient` accepts an
  `authProvider` (`AuthHeadersProvider`); auth headers are merged last
  (identity is never caller-overridable); a throwing provider fails the
  request closed before it is sent.
- `apps/mobile/src/navigation/root-navigator.tsx` — renders the restoring
  splash for `restoring`, the auth boundary for `unauthenticated` and
  `authentication-error`, and the app boundary only for `authenticated`.
- `apps/mobile/src/navigation/routes.ts` — added `AuthRestoring` route.
- `apps/mobile/README.md` — Phase 3.14 status and boundary table.
- Tests: `auth-provider.test.tsx` (one assertion updated to the richer
  state, see §13) and `root-navigator.test.tsx` (restoring + error cases).

No backend file, Prisma schema, migration, seed, environment file, or shared
package was modified.

## 6. Mobile auth flow

```
App start
  → AuthProvider
  → client.getSession()            (restoring splash while pending)
  → authStateFromSession(null)    → unauthenticated  → auth boundary
  → authStateFromSession(session) → authenticated    → app boundary
  → authStateFromFailure(err)     → authentication-error → auth boundary (fail closed)
```

Authenticated content is never rendered before identity is established, and a
failed restore never surfaces authenticated content or raw provider detail
(§9/§10/§13 of the phase spec).

## 7. Session model

- `AuthSession { user: AuthenticatedUser }` — unchanged, minimal.
- New `AuthState` discriminated union is the canonical session lifecycle:
  `restoring` · `unauthenticated` · `authenticated` (carries the session) ·
  `authentication-error` (carries a normalized `MobileError`, never a
  session).
- No persistence, no tokens, no storage — nothing exists to persist while
  OD-005 is open. Session restoration is the existing `getSession()` port,
  now classified by the pure `session-restore` helpers.

## 8. Identity model

- Canonical identity remains `AuthenticatedUser { userId }` (§8 of the phase
  spec). No password, hash, access/refresh token, secret, or provider
  credential was added to the model, and no backend database record is
  exposed to the mobile layer.
- `createAuthenticatedUser`/`createAuthSession` validate a non-blank `userId`
  and are the only entry points; a test pins the payload to exactly
  `{ userId }` / `{ user: { userId } }`.

## 9. API integration

- `createApiClient` now receives session credentials through the explicit
  `AuthHeadersProvider` seam (`src/auth/auth-headers.ts`) — no `Authorization`
  headers are scattered through individual API calls.
- Auth-provided headers always win over client/per-request headers, so a
  caller can never override identity. If the provider throws, the request
  fails closed with a normalized error and is never sent.
- The default provider is `noAuthHeadersProvider` (resolves null) — with
  OD-005 open, no auth header is ever attached. No caller-supplied `userId`
  is accepted anywhere; the backend remains the authority for identity.

## 10. Realtime integration

Authentication is NOT actually implemented (OD-005 open), so no realtime
transport change was made (§12 of the phase spec applies only when a real
mechanism lands). The Phase 3.13 `RealtimeClient` port stays fail-closed and
unchanged; its existing test already pins that it never fabricates a
connection or accepts a caller-controlled `userId`. Integration point for the
approved mechanism: a future transport attaches the same credential the
`AuthHeadersProvider` supplies at connect time and lets the backend derive
identity; recipients/rooms stay server-controlled. No chat, presence,
location streaming, or ride live tracking was added.

## 11. Navigation behavior

- `restoring` → `RestoringBoundaryScreen` (deterministic splash, no network).
- `unauthenticated` and `authentication-error` → `AuthBoundaryScreen` (public,
  fail closed).
- `authenticated` → `AppBoundaryScreen` (authenticated placeholder).
- No real login/signup screens were built: the phase spec allows them only if
  the approved auth decision requires them, and OD-005 is open.

## 12. Security model

- Never logs credentials/tokens/payloads; no logging exists.
- Fail-closed everywhere: `noAuthHeadersProvider`, `unavailableAuthClient`,
  `authentication-error` state, auth headers merged last, provider failure
  aborts the request.
- `normalizeAuthError` maps every thrown value to a `MobileError`; tests
  assert raw messages, stack traces, and credentials never reach UI state.
- No fake tokens, no fake users, no fake credentials, no invented storage.
- No secure credential storage was added (OD-005 unresolved — nothing
  approved to persist).

## 13. Testing

- Existing Phase 3.13 tests preserved; one assertion in
  `auth-provider.test.tsx` was updated because the phase mandate (§9/§10)
  changed the restore-failure settlement from `unauthenticated` to the richer
  `authentication-error` state — a behavior correction like the Phase 3.10
  404 change, not a test weakened to pass. The updated test still asserts
  fail-closed (no session, not authenticated).
- New coverage: initial `restoring` state, `unauthenticated`, `authenticated`,
  session restoration, restoration failure, sign-in success, sign-in failure
  (state + rethrow), sign-out, auth error normalization, protected navigation
  (restoring/error boundaries never show authenticated content), API
  credential propagation (headers attached / null / caller-override blocked /
  provider failure aborts), identity propagation (payload pinned to
  `{ userId }`), fail-closed behavior, sensitive-data non-leakage.
- Real-time integration: not implemented (OD-005 open); the existing realtime
  seam tests remain and cover the no-caller-userId guarantee.
- Deterministic vitest, mocked `fetch`, no network, no real provider, no real
  authentication account.

Mobile: **86 tests / 15 files** (baseline 53).

## 14. Database impact

**None.** No schema change, no migration, no seed change. `prisma validate`,
`prisma migrate status`, and `db:check` remain green. No speculative columns
(`passwordHash`, `refreshToken`, `verificationCode`, `otp`, `authProvider`,
`accountStatus`, …) were added — OD-005 is open.

## 15. Open decisions

Preserved, unresolved:

- **OD-005 — authentication mechanism — OPEN.** Actual authentication was not
  implemented. No provider was chosen or invented.
- OD-004 (matching thresholds/weights) — OPEN.
- OD-007 (routing/map provider) — OPEN.
- OD-008 (realtime delivery details) — OPEN.
- OD-010 (verification) — OPEN.

## 16. Limitations

- No real sign-in/registration — the app always renders the public boundary
  until OD-005 resolves and a real `AuthClient` + `AuthHeadersProvider` is
  injected.
- No session persistence/restoration from secure storage (nothing approved to
  store).
- No authentication UI, no token/session semantics, no refresh/revocation.
- Realtime stays interface-only and fail-closed.

## 17. Verification commands

```bash
pnpm --filter @ridepool/mobile typecheck
pnpm --filter @ridepool/mobile lint
pnpm --filter @ridepool/mobile test
pnpm --filter @ridepool/backend typecheck
pnpm --filter @ridepool/backend lint
pnpm --filter @ridepool/backend test
pnpm --filter @ridepool/backend build
pnpm --filter @ridepool/backend exec prisma validate
pnpm --filter @ridepool/backend exec prisma migrate status
pnpm --filter @ridepool/backend db:check
pnpm format:check
```

Expected baseline: backend 701 tests, mobile 53 tests. Results after
implementation are reported in the phase final report.

## 18. Phase boundary

**Phase 3.14 (Mobile Authentication & Identity Boundary) is complete in its
provider-ready scope.** Actual authentication is explicitly blocked by
OD-005 and was NOT implemented. Phase 3.15+ features were NOT started: no
ride UI, no discovery/matching/request/accept UI, no maps, no GPS/permissions,
no push, no chat, no payments, no analytics, no admin, no offline sync, no
location tracking. No backend business logic, database, migration, or API
contract was modified.
