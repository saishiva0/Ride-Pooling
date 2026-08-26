# Phase 3.13 — Mobile Foundation: Implementation Notes

> Status: Phase 3.13 — Implementation
> Records how the mobile engineering foundation was built on top of the
> verified Phase 3.12 state. No backend business logic, database, schema,
> migration, or API endpoint was changed. **OD-005 (authentication), OD-004
> (matching thresholds), OD-007 (map provider), OD-008 (realtime details), and
> OD-010 (verification) remain OPEN** — nothing here resolves a product
> decision, and no business feature was implemented.

## 1. Scope

Establish the production-structured engineering backbone of the existing
`apps/mobile` workspace: application shell, configuration, navigation
boundaries, a safe API client consuming the shared contracts, auth and
realtime provider-neutral seams, an async state model, a minimal UI/theme
foundation, deterministic testing, and documentation. Explicitly NOT in
scope: any ride/auth/map/push/payment feature, any backend change, any
database change.

## 2. Existing mobile state before implementation

`apps/mobile` already existed with a minimal Phase-1-era scaffold:

- `package.json` — `@ridepool/mobile`, Expo ~57.0.12, React 19.2.3, React
  Native 0.86.2, vitest, TypeScript ~6.0.3. **No workspace dependencies**
  (`@ridepool/shared` / `@ridepool/config` were not linked).
- `App.tsx` — a root screen that performed a live `fetch` to the backend
  health endpoint and rendered "RidePool / API: … / Backend health: …".
- `src/lib/api.ts` (+ `api.test.ts`, 3 tests) — `DEFAULT_API_BASE_URL`,
  `resolveApiBaseUrl`, `buildHealthUrl` helpers.
- `vitest.config.ts` — Node environment, `src/**/*.test.ts`, `@` alias.
- `.env.example` — `EXPO_PUBLIC_API_URL` with platform notes.
- `app.json`, `index.ts`, assets — standard Expo scaffold.

This scaffold was preserved and upgraded where useful rather than replaced:
the URL helpers were moved (not rewritten) into the centralized config module,
the health-check fetch was removed from the root screen so the shell is
deterministic, and the package identity/scripts were kept.

## 3. Files created

```
apps/mobile/
  README.md
  App.test.tsx
  tests/
    setup.ts                     — enables React act environment for render tests
    render.tsx                   — react-test-renderer helpers (renderAndSettle, extractText)
    mocks/react-native.ts        — minimal RN mock (test infra, aliased under vitest)
    mocks/expo-status-bar.ts     — StatusBar mock (test infra)
  src/
    theme/index.ts               — colors, spacing, typography baselines
    components/screen.tsx        — Screen container (safe area + padding)
    config/env.ts                — centralized config (loadMobileConfig, resolveApiBaseUrl, buildHealthUrl)
    config/env.test.ts
    api/errors.ts                — MobileError + MobileErrorKind + classifiers
    api/errors.test.ts
    api/client.ts                — createApiClient / request<T> (shared envelopes)
    api/client.test.ts
    state/async.ts               — AsyncState<T> model + guards
    state/async.test.ts
    hooks/use-async.ts           — useAsync hook
    hooks/use-async.test.tsx
    auth/types.ts                — AuthenticatedUser / AuthSession / AuthStatus
    auth/auth-client.ts          — AuthClient port + unavailableAuthClient (fail closed)
    auth/auth-client.test.ts
    auth/auth-provider.tsx       — AuthProvider + useAuth context
    auth/auth-provider.test.tsx
    realtime/events.ts           — mirrored Phase 3.11 event contract (6 types)
    realtime/events.test.ts
    realtime/realtime-client.ts  — RealtimeClient port + unavailableRealtimeClient (fail closed)
    realtime/realtime-client.test.ts
    navigation/routes.ts         — route groups + typed route model
    navigation/root-navigator.tsx— boundary selection from auth status
    navigation/root-navigator.test.tsx
    screens/auth-boundary-screen.tsx   — "Authentication not configured" placeholder
    screens/app-boundary-screen.tsx    — authenticated placeholder
docs/development/phase-3-13-notes.md  — this document
```

## 4. Files modified

- `apps/mobile/package.json` — added workspace deps `@ridepool/shared` /
  `@ridepool/config`; added dev deps `react-test-renderer@19.2.3` and
  `@types/react-test-renderer` (deterministic render tests). Scripts unchanged.
- `apps/mobile/App.tsx` — rewrote the shell: `AuthProvider` →
  `RootNavigator` → `StatusBar`; deterministic (no network call).
- `apps/mobile/vitest.config.ts` — include `src/**/*.test.tsx`,
  `setupFiles: ['./tests/setup.ts']`, and aliases for `react-native` /
  `expo-status-bar` → `tests/mocks/` (test-only).
- `apps/mobile/.env.example` — documented the reserved `EXPO_PUBLIC_REALTIME_URL`.
- Deleted `apps/mobile/src/lib/` (Phase-1 scaffold) — its helpers moved to
  `src/config/env.ts` with the same behavior (tested).
- `pnpm-lock.yaml` — updated by `pnpm install` for the new workspace links.

No backend file, Prisma schema, migration, seed, or environment file was
modified.

## 5. Mobile architecture

```
App.tsx (shell — no business logic)
  └── AuthProvider (auth boundary: AuthClient port → session state)
        └── RootNavigator (navigation: status → boundary)
              ├── AuthBoundaryScreen   (public placeholder)
              └── AppBoundaryScreen   (authenticated placeholder)

src/config  → environment (single source)
src/api     → HTTP (shared {data}/{error} contracts, normalized errors)
src/realtime→ realtime port (provider-neutral, fail closed)
src/state   → AsyncState model (no global store)
src/hooks   → useAsync
src/theme   → colors/spacing/typography baselines
src/components → Screen primitive
```

Dependency direction: screens/components depend on the boundaries, never the
reverse; the boundaries depend on `@ridepool/shared` contracts and
`@ridepool/config`. Mobile imports NO backend-only module, no Prisma types, no
server code.

## 6. Navigation architecture

- Typed, framework-free route model (`navigation/routes.ts`): two conceptual
  route groups — the public/authenticated boundary (`auth`) and the
  authenticated application boundary (`app`) — plus `RouteParamList` for
  future library mapping.
- `RootNavigator` renders the **auth boundary whenever no authenticated
  session exists** (fail-closed, deterministic) and the app boundary when a
  session exists. It observes only session status — it never touches
  credentials or calls `signIn`.
- No react-navigation dependency was added: there are no real screens to
  navigate between yet, and the phase explicitly warns against large
  frameworks for small problems (principle O / §26). When Phase 3.14 adds
  real screens, the route groups map directly onto a navigation library.

## 7. API client architecture

- `api/client.ts` — `createApiClient({ baseUrl, timeoutMs?, headers? })`
  returns `{ request<T>(path, options) }`. Paths are relative to the versioned
  namespace: the client prepends `API_BASE_PATH` (`/api/v1`) from
  `@ridepool/shared` (no duplicated magic strings). Requests are JSON via
  `fetch` with an `AbortController` timeout (default 10 s).
- Consumes the shared contracts directly: success `{ data: ... }`
  (`ApiDataResponse`) is unwrapped; errors `{ error: { code, message, field?,
details? } }` (`ApiErrorResponse`) map to `MobileError` via
  `apiErrorFromBody`. A malformed success body (no `data`) is a normalized
  error, never a raw leak.
- `api/errors.ts` — `MobileError` with a machine-readable `kind` covering the
  documented classes: network, timeout, validation, authentication,
  authorization, not-found, conflict, business-rule, rate-limited,
  external-service, server, unknown. `toMobileError` normalizes any thrown
  value (network `TypeError` → 'network', `AbortError` → 'timeout', else
  'unknown'); raw transport errors and stack content never reach the UI.
- The client is generic (`request<T>`) — no ride-specific functions, no
  duplicated backend business validation.

## 8. Authentication seam

- `auth/types.ts` — `AuthenticatedUser { userId }`, `AuthSession { user }`,
  `AuthStatus`; structurally identical to the Phase 3.9 backend identity
  contract (mirrored deliberately — mobile cannot import backend-only
  modules; package boundary maintained).
- `auth/auth-client.ts` — the `AuthClient` port (getSession / signIn /
  signOut). The default `unavailableAuthClient` FAILS CLOSED: `getSession()`
  → `null`, `signIn()` throws `AuthenticationUnavailableError`, `signOut()` is
  a no-op. No fake credentials, no fake JWTs, no tokens, no persistence.
- `auth/auth-provider.tsx` — React context bridging the port to the UI
  (status / session / isAuthenticated / signIn / signOut). Session restore
  failures settle to 'unauthenticated' (fail closed). Injectable client for
  tests/future phases.

## 9. Realtime seam

- `realtime/events.ts` — mirrors the Phase 3.11 backend event contract
  EXACTLY: the same six types (`RIDE_REQUESTED`, `REQUEST_ACCEPTED`,
  `REQUEST_REJECTED`, `RIDE_CANCELLED`, `RIDE_EXPIRED`, `RIDE_CONFIRMED`) and
  the same `RealtimeEvent` shape (a test pins the six types).
- `realtime/realtime-client.ts` — the provider-neutral `RealtimeClient` port
  (connect / disconnect / subscribe / connectionState). The default
  `unavailableRealtimeClient` FAILS CLOSED: `connect()` and `subscribe()`
  throw `RealtimeUnavailableError`; `disconnect()` is a no-op.
- **No Socket.io client was installed**: the backend realtime layer is
  disabled by default and sockets fail closed while OD-005 is open, so the
  smallest correct seam is the interface only (§14 of the phase spec). A
  transport implementation plugs into this port when a realtime decision
  lands.
- No `userId` is ever accepted from client-controlled state; the recipient is
  always server-determined (per the Phase 3.11 contract).

## 10. Configuration

- `config/env.ts` — single source for environment values:
  `loadMobileConfig()` → `{ env, apiBaseUrl, realtimeUrl }`. Reads
  `EXPO_PUBLIC_API_URL` and the reserved `EXPO_PUBLIC_REALTIME_URL`; the
  environment name is parsed with the shared `parseNodeEnv` from
  `@ridepool/config` (reused, not reimplemented).
- `resolveApiBaseUrl` / `buildHealthUrl` moved here from the Phase-1
  `src/lib/api.ts` with identical behavior (existing tests preserved and
  extended). Platform differences (iOS simulator / Android emulator / physical
  device) are documented in `.env.example` and the module docs.
- No secrets, no committed `.env` files; only `EXPO_PUBLIC_*` values are
  inlined by Expo.

## 11. Testing setup

- Deterministic vitest (Node environment, no network, no real sockets):
  `src/**/*.test.{ts,tsx}`, `tests/setup.ts` (React `act` environment).
- Pure-logic suites: config, API errors, API client (mocked `fetch` via
  `vi.stubGlobal`), async state, auth client, realtime client, realtime
  events.
- Render suites (`App`, `AuthProvider`, `RootNavigator`, `useAsync`) use the
  official `react-test-renderer` with minimal `react-native` /
  `expo-status-bar` mocks in `tests/mocks/`, resolved ONLY under vitest via
  config aliases — the app at runtime uses the real modules (Metro). The
  `tests/render.tsx` helper (`renderAndSettle` + `extractText`) makes render
  assertions deterministic and microtask-safe.
- Coverage of the phase's required list: root renders, navigation boundary
  renders, config loads, API client builds correct requests, success envelope
  parses, error envelope parses, normalized errors work, auth seam defaults
  safely, realtime seam is provider-independent, shared contracts consumed.

## 12. Security considerations

- Never logs credentials/tokens/payloads: no logging exists in the
  foundation; `MobileError` messages never include raw transport internals or
  stack traces.
- Fail-closed defaults everywhere: no session (auth), no transport
  (realtime), no authenticated content rendered without a session.
- No caller-provided identity is ever trusted; the realtime recipient is
  server-determined.
- No secrets in code or committed env files; environment configuration is
  separate from any future secrets.
- `Content-Type: application/json` only; nothing sensitive is added to
  headers in this phase (future tokens plug in at the client boundary).

## 13. Dependencies added/changed

- `@ridepool/shared` (workspace) — consumes `ApiDataResponse`,
  `ApiErrorResponse`, `API_BASE_PATH`, `ErrorCode`.
- `@ridepool/config` (workspace) — reuses `parseNodeEnv` / `NodeEnv`.
- `react-test-renderer@19.2.3` (dev, matching React 19.2.3) +
  `@types/react-test-renderer` — deterministic render tests.
- No map/location/GPS/auth-provider/push/payment/chat SDKs were installed.
  No Socket.io client was installed (interface only).

Note: `react-test-renderer` is deprecated upstream (React 19) and emits a
deprecation warning in render tests. It is used because it is the
deterministic, officially supported Node renderer for this exact React
version; a maintained replacement (e.g. React Native Testing Library on a
vitest-compatible setup) can be adopted without changing the test surface.

## 14. Decisions deliberately NOT made

- No navigation library (react-navigation) — deferred to the phase that adds
  real screens; the typed route groups already define the boundary.
- No state-management framework (Redux/Zustand/MobX) — the small `AsyncState`
  model suffices; no global store for future features (phase principle P).
- No Socket.io client dependency — interface only, per the phase spec.
- No location/maps mobile boundary — Phase 3.12 defined the provider-neutral
  contracts and no mobile feature consumes coordinates yet; a boundary would
  be premature abstraction (principle O). Documented for Phase 3.14+.
- No authentication persistence/storage — nothing to persist while OD-005 is
  open.
- These are implementation constraints, NOT product decisions; no ADR was
  added and no open decision was resolved.

## 15. Open decisions preserved

- **OD-005 (authentication mechanism) — OPEN.** No credentials, tokens,
  storage, or provider; the mobile auth boundary is a fail-closed port.
- **OD-007 (map/routing/geocoding provider) — OPEN.** No map SDK, no GPS, no
  permissions, no mobile location boundary.
- **OD-008 (realtime delivery details) — OPEN.** Realtime is interface-only
  and fail-closed; the backend stays disabled by default.
- **OD-004 (matching thresholds/weights) — OPEN.** No matching UI or logic.
- **OD-010 (verification) — OPEN.** No verification concepts introduced.

## 16. Known limitations

- No authentication UI/flow — the app always renders the auth placeholder
  until OD-005 resolves and a real `AuthClient` is injected.
- No realtime transport — `connect()`/`subscribe()` throw until a transport
  is configured.
- Navigation is framework-free; there are no real screens or deep links.
- `react-test-renderer` deprecation warning in render tests (see §13).
- The shell no longer pings `/health` (removed for determinism); backend
  connectivity is covered by the backend health endpoint and the mobile API
  client tests.

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

Results: mobile typecheck/lint/tests pass (53 tests); backend suite remains
green (701 tests); Prisma schema valid, migrations up to date, database
connectivity OK; root format check passes. (Expo native export is not
supported in this environment — no web deps or native toolchain — so the gate
used typecheck/lint/tests, the same approach as prior phases.)

## 18. Phase boundary confirmation

**Phase 3.13 (Mobile Foundation) is COMPLETE. Phase 3.14 (Creator Mobile
Flow) and later phases were NOT started.** No login/signup UI, no password or
JWT handling, no ride UI, no map UI, no GPS/permissions, no push, no chat, no
payments, no analytics, no offline sync. No backend endpoint, Prisma schema,
migration, seed, or database change was made. Open decisions remain open.
