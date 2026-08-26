# Phase 3.15 — Mobile Ride Participant Flow: Implementation Notes

> Status: Phase 3.15 — Implementation
> Builds the authenticated ride experience (discover → details → request →
> request states → notifications, plus creator accept/reject/cancel where the
> backend allows) on the Phase 3.13 foundation and Phase 3.14 identity
> boundary. No backend file, Prisma schema, migration, seed, or API contract
> was changed. OD-005, OD-004, OD-007, OD-008 and OD-010 remain OPEN and were
> NOT resolved.

## 1. Product decisions honored

- **OD-005 (authentication) — OPEN.** The app only renders the authenticated
  ride shell when an `AuthProvider` exposes an authenticated session (Phase
  3.14). Identity is never client-supplied: no caller `userId` is accepted by
  `RideApi`; the backend derives identity from the API client's auth headers
  (fail-closed `noAuthHeadersProvider` by default, so all ride calls fail
  closed until a real provider is injected). `userId` is read in the UI ONLY
  for presentational decisions (creator-only actions).
- **OD-004 (matching thresholds/weights) — OPEN.** `RideApi.matchRides`
  exists and is contract-tested, but it is NOT wired to any default UI: it
  requires the OD-004 `MatchingConfiguration` thresholds, which are never
  defaulted. The participant discovery flow uses plain location discovery
  (`GET /api/v1/rides/discover`), which needs no product decision.
- **OD-007 (maps/GPS) — OPEN.** No GPS, no permissions, no maps. Coordinates
  are typed into the discovery form (matching the backend's numeric input).
- **OD-008 (realtime) / OD-010 (verification) — OPEN.** No socket client
  integration, no push, no verification flows. Notification state is a
  poll-on-mount read of `GET /api/v1/notifications`.

## 2. Backend contracts consumed (unchanged, all under `/api/v1`, auth-required)

1. `GET /rides/discover?latitude=&longitude=&radiusMeters=&maxPricePerKm=` →
   `DiscoverRideDto[]`
2. `POST /rides/match` (body `MatchRidesInput`) → `DiscoveredRideDto[]`
3. `POST /rides` (body `RideCreationInput`) → `CreatedRideDto`
4. `POST /rides/:rideId/requests` (body `{ requestedSeats }`) → `RideRequestDto`
5. `POST /rides/:rideId/requests/:requestId/accept` → `RideRequestDto`
6. `POST /rides/:rideId/requests/:requestId/reject` → `RideRequestDto`
7. `POST /rides/:rideId/cancel` → `CancelledRideDto`
8. `GET /notifications?limit=` → `RideNotificationListDto`
9. `POST /notifications/:notificationId/read` → `RideNotificationDto`
10. `POST /notifications/read-all` → `RideNotificationListDto`

Success envelope `{ data }`; error envelope `{ error: { code, message,
field?, details? } }` (already handled by the shared `ApiClient` /
`MobileError` from Phase 3.13).

## 3. Files created

```
apps/mobile/src/ride/api.types.ts             — wire DTO types + request/response shapes
apps/mobile/src/ride/types.ts                 — mobile models (Date-based)
apps/mobile/src/ride/mappers.ts               — pure wire → model mappers
apps/mobile/src/ride/format.ts                — UTC-deterministic date/distance/price formatting
apps/mobile/src/ride/validation.ts            — parseDiscoveryForm / parseRequestedSeats
apps/mobile/src/ride/api.ts                   — createRideApi(client) + RideApi + buildQuery
apps/mobile/src/ride/request-store.ts         — session-local request store (subscribe/notify)
apps/mobile/src/components/loading-view.tsx   — LoadingView
apps/mobile/src/components/error-view.tsx     — ErrorView (normalized message + retry)
apps/mobile/src/components/empty-view.tsx     — EmptyView
apps/mobile/src/components/ride-card.tsx      — RideCard (pressable summary)
apps/mobile/src/navigation/app-navigator.tsx  — authenticated ride shell (tabs + push)
apps/mobile/src/screens/rides/rides-home-screen.tsx        — discovery
apps/mobile/src/screens/rides/ride-details-screen.tsx      — ride detail + request/cancel
apps/mobile/src/screens/requests/my-requests-screen.tsx    — session-local requests
apps/mobile/src/screens/notifications/notifications-screen.tsx — notifications + decisions
apps/mobile/tests/fixtures.ts                 — DTO/model builders + fakeNavigation + fakeRideApi
```

Test files created: `ride/mappers.test.ts` (11), `ride/format.test.ts` (6),
`ride/validation.test.ts` (13), `ride/api.test.ts` (15),
`ride/request-store.test.ts` (5), `components/ride-card.test.tsx` (3),
`navigation/app-navigator.test.tsx` (3),
`screens/rides/rides-home-screen.test.tsx` (5),
`screens/rides/ride-details-screen.test.tsx` (7),
`screens/requests/my-requests-screen.test.tsx` (3),
`screens/notifications/notifications-screen.test.tsx` (9).

## 4. Files modified

- `apps/mobile/src/navigation/routes.ts` — added `Rides`, `RideDetails`,
  `Requests`, `Notifications` routes and `RouteParamList` (RideDetails carries
  the `{ ride: RideSummary }` snapshot). The ride is passed as a snapshot
  because the backend has no single-ride GET endpoint (documented limitation).
- `apps/mobile/src/navigation/root-navigator.tsx` — renders `<AppNavigator />`
  for the authenticated session (replaces the Phase 3.14 authenticated
  placeholder). `root-navigator.test.tsx` updated accordingly.
- `apps/mobile/src/api/errors.ts` — added `mobileErrorMessage(error)` for
  human-readable, context-carrying error text; `errors.test.ts` extended.
- `apps/mobile/src/theme/index.ts` — added `colors.danger` (destructive
  actions/errors).
- `apps/mobile/tests/render.tsx` — added `press`, `typeInto`, and `findAll`
  (host-node matching with RegExp support for accessibility labels).
- `apps/mobile/tests/mocks/react-native.ts` — added ScrollView, TextInput,
  ActivityIndicator to the deterministic RN mock.
- Deleted `apps/mobile/src/screens/app-boundary-screen.tsx` (superseded by the
  real ride shell).

No backend file, Prisma schema, migration, seed, environment file, or shared
package was modified.

## 5. Ride API surface (`src/ride/api.ts`)

`RideApi` (injected; `createRideApi(client)` wires the real one):

- `discoverRides(input)` — `GET /rides/discover` (buildQuery encodes lat/lng/
  radiusMeters/maxPricePerKm only when present; no OD-004 defaults)
- `matchRides(input)` — `POST /rides/match` (explicit config required; not
  wired to default UI)
- `createRide(input)` — `POST /rides`
- `requestSeats({ rideId, requestedSeats })` — `POST /rides/:rideId/requests`
- `acceptRequest({ rideId, requestId })` — accept path
- `rejectRequest({ rideId, requestId })` — reject path
- `cancelRide({ rideId })` — `POST /rides/:rideId/cancel`
- `listNotifications(limit?)` — `GET /notifications`
- `markNotificationRead(id)` / `markAllNotificationsRead()`

`api.test.ts` pins the exact paths, query strings, bodies, and
`{ data }`/`{ error }` decoding for all ten calls (including non-2xx error
propagation via the shared client). No caller identity is ever sent.

## 6. Navigation and screen flow

```
AppNavigator (authenticated)
  ├─ tabs:
  │   ├─ Rides  (discovery home)
  │   ├─ Requests (session-local, via request-store)
  │   └─ Notifications
  └─ push: RideDetails ({ ride: RideSummary })  (+ Back)
```

- No react-navigation (none approved): the shell is a typed route model +
  framework-free switch with an explicit `AppNavigation` interface
  (`navigate(route, params?)` / `goBack()`), `AppStackEntry` union, and
  selected-tab state. `app-navigator.test.tsx` drives the whole flow
  (discover → details → request → My Requests shows PENDING) end to end.
- `RideDetailsScreen`: requests seats (`parseRequestedSeats`, 1..max) for
  REQUESTABLE_STATUSES (`PUBLISHED`, `CONFIRMED`); creator-only cancel for
  `PUBLISHED`; `lastRequestedId` effect reports each successful request to the
  request store exactly once; conflict errors are normalized.
- `RidesHomeScreen` (discovery): typed lat/lng/radius form validated by
  `parseDiscoveryForm` (radius km → meters); `inputRef` pattern avoids stale
  closures in the `useAsync` operation; hint/loading/error/empty/results states.

## 7. Session-local request store (`src/ride/request-store.ts`)

The backend exposes request creation (`POST /rides/:rideId/requests`) but no
request-list endpoint, so "My Requests" reflects what this session has
successfully submitted (last-known statuses: PENDING, ACCEPTED, REJECTED —
updated when the creator decides from the Notifications screen). This is an
explicit, documented limitation; a real request list is a backend-contract
matter, not a mobile workaround. The store is `subscribe/notify`, owned by
`AppNavigator`, and session-local (no persistence).

## 8. Notifications screen

Reads `GET /notifications` on mount (deterministic, poll-on-mount; no
realtime — OD-008 open). Features: unread count, tap-to-mark-read, mark all
read, and creator decisions (accept/reject) on `RIDE_REQUESTED` notifications.
Mutation state is local (`pendingReadId`, `pendingDecisionByRequest`,
`actionedByRequest`, `actionErrorByRequest`, `mutationError`) and fully
deterministic — all 9 tests inject a fake `RideApi`, no network.

## 9. Formatting (UTC-deterministic)

`src/ride/format.ts` formats dates/times as UTC (e.g. `Aug 18, 2026 · 10:05`),
distances in km (`1.2 km`), and prices as `/km` (`2.50 /km`) — all
timezone-independent so render tests are stable. 6 tests pin the output.

## 10. Testing

- Mobile: **169 tests / 26 files** (baseline 86 / 15). New coverage: mappers,
  formatting, form/seat validation, every `RideApi` call (paths/bodies/
  envelopes/errors), request store, RideCard, both ride screens, My Requests,
  Notifications (incl. decisions), and the navigator end-to-end flow.
  `mobileErrorMessage` normalization added to the API errors suite.
- `tests/fixtures.ts` provides DTO/model builders (so screen tests never touch
  wire shapes), `fakeNavigation`, and a typed `fakeRideApi`. `tests/render.tsx`
  provides `press`/`typeInto`/`findAll` against the mocked host tree (RegExp
  labels supported; ambiguous matches throw).
- Deterministic vitest (Node env, mocked RN), no network, no real provider,
  no GPS/maps.

## 11. Security model

- Fail-closed: default `noAuthHeadersProvider` means ride calls carry no
  identity until OD-005 resolves; any real provider is injected through the
  Phase 3.14 seam and merged last.
- No caller-supplied identity, no tokens/credentials in code or logs.
- Creator-only actions are presentational decisions only; the backend remains
  the authority (it derives identity from headers and enforces ownership).

## 12. Database impact

**None.** No schema change, migration, or seed change. `prisma validate`,
`prisma migrate status`, and `db:check` remain green.

## 13. Open decisions

Preserved, unresolved: OD-005 (auth), OD-004 (matching thresholds), OD-007
(maps/routing), OD-008 (realtime), OD-010 (verification).

## 14. Limitations

- No GPS/maps: discovery coordinates are typed (OD-007 open).
- No realtime/push: notifications are poll-on-mount (OD-008 open).
- No request-list backend endpoint: My Requests is session-local.
- No single-ride GET: ride details render from the discovery snapshot.
- No ride creation UI (mobile create is `RideApi.createRide`, not wired to
  screens) and no matching UI (OD-004 open).
- "Discover rides" button is labelled "Find rides" (screen) and "Discover"
  (tab) to keep the accessibility labels unambiguous.

## 15. Verification commands

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

Expected baseline: backend 701 tests, mobile 86 tests / 15 files. Results
after implementation are reported in the phase final report.

## 16. Phase boundary

**Phase 3.15 (Mobile Ride Participant Flow) is complete.** Phase 3.16+
features were NOT started: no maps/GPS/permissions, no push/realtime client,
no chat/payments, no admin, no offline sync, no live location tracking, no
ride creation/matching UI, no verification. No backend business logic,
database, migration, or API contract was modified.
