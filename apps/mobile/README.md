# RidePool Mobile

Mobile application workspace (React Native + Expo) — **Phase 3.23: Push
Notifications** (built on Phase 3.22 Realtime Productionization, Phase 3.21
Request & Participant Lifecycle Completion, Phase 3.20 Google Maps & Location
Integration (OD-007), Phase 3.19 Matching Resolution + Mobile Matching
Experience (OD-004), Phase 3.18 Phone + OTP Authentication (MSG91, OD-005),
Phase 3.16 Mobile Location, GPS & Maps Foundation, Phase 3.15 Mobile Ride
Participant Flow, Phase 3.13 Mobile Foundation and Phase 3.14 Mobile
Authentication & Identity Boundary).

> **OD-005 (authentication mechanism) is RESOLVED** — Phase 3.18 implements the
> full phone + OTP flow: `PhoneEntryScreen` → `OtpVerificationScreen` → secure
> bearer session (`expo-secure-store`), with session restore re-validated
> against the backend (`GET /auth/me`) and the ride API authenticating through
> the stored headers provider.
>
> **OD-004 (matching thresholds) is RESOLVED** — Phase 3.19 implements the
> approved V1 matching policy (5 km pickup radius, ±60 min departure window,
> 5 km destination tolerance, no numeric score, deterministic ranking:
> pickup distance → time proximity → ride ID, max 20 results, server-controlled
> configuration). The mobile matching experience (`MatchingScreen`) is now
> wired end-to-end: participant journey intent (pickup, destination, departure
> time, optional seats) → `POST /api/v1/rides/match` → eligible matches with
> structured factor explanations.
>
> **OD-007 (maps/GPS provider) is RESOLVED** — Phase 3.20 integrates Google
> Maps Platform behind provider-neutral ports (`GeocodingProvider`,
> `RoutingProvider`, existing `LocationClient`): map view + geocoding
> (Google Geocoding) + route preview (Google Routes) on the ride discovery,
> create-ride, and ride-details screens. All Google calls are client-side REST
> with a public, Android/iOS-restricted key (`EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`);
> the backend is untouched. With no key configured everything fails closed (map
> placeholder, no route preview). See `docs/development/phase-3-20-notes.md`.
>
> **Phase 3.21** completes the participant-side lifecycle: My Requests now
> offers Withdraw (PENDING) and Cancel participation (ACCEPTED) actions via
> `POST /api/v1/rides/:rideId/requests/:requestId/cancel` (seat release,
> last-participant CONFIRMED → PUBLISHED revert server-side), and the realtime
> contract gains `REQUEST_CANCELLED` (six → seven types). OD-002 (cancellation
> windows/grace periods) remains OPEN — only canonical state-based rules are
> implemented. See `docs/development/phase-3-21-notes.md`.
>
> **Phase 3.22 (realtime half of OD-008 RESOLVED)** productionizes the
> Socket.io client (`src/realtime/socket-client.ts`): authenticated connection
> (bearer token in `extraHeaders`), reconnect with backoff, connection-state
> tracking, and lifecycle wired to `AuthProvider` (connect on `authenticated`,
> disconnect otherwise). See `docs/development/phase-3-22-notes.md`.
>
> **Phase 3.23 (push-provider half of OD-008 RESOLVED)** adds Expo push
> notifications as a third delivery channel alongside the persisted-notification
> feed and Socket.io: `src/notifications/` handles permission state (never
> re-prompts after denial), Expo push token acquisition/registration
> (`POST/DELETE /api/v1/notifications/device-tokens`), foreground/background
> presentation, and tap routing to the notifications feed (never a fabricated
> ride snapshot — see `docs/planning/phases/phase-3-23.md` §7). Token lifecycle
> is tied to auth state via `useNotificationsAuth()`: registers on
> `authenticated`, deactivates on `unauthenticated`/logout (best-effort — logout
> always succeeds). A real EAS project id is still required in `app.json`
> (`extra.eas.projectId` is a placeholder) before a real push token can be
> obtained — see `docs/development/phase-3-23-notes.md`.

## Layout

```
apps/mobile/
  App.tsx                — deterministic application shell (AuthProvider +
                           RootNavigator + StatusBar; no business logic)
  src/
    theme/               — colors, spacing, typography baselines
    components/          — Screen container + Loading/Error/Empty views + RideCard
    config/              — centralized environment configuration
    api/                 — API client + normalized MobileError model
    auth/                — AuthClient (phone+OTP), AuthProvider, AuthState union,
                           secure session storage (expo-secure-store), stored
                           headers provider, session-restore, error normalization
    realtime/            — RealtimeClient port + concrete Socket.io client +
                           mirrored event contract
    notifications/       — Expo push: permissions, token lifecycle,
                           foreground/background handlers, tap routing
    location/            — LocationClient port (fail-closed default), permission
                           model, acquisition state, WGS84 coordinate rules,
                           GeoJSON serialization, LocationReference helpers
    ride/                — ride domain: API client, wire DTOs, models, mappers,
                           formatting, validation, session-local request store
    navigation/          — typed route model + RootNavigator (boundaries) +
                           AuthNavigator (phone+OTP) + authenticated ride shell
    screens/             — auth (phone entry + OTP verification), rides,
                           requests, notifications
    state/               — AsyncState model (idle/loading/success/error)
    hooks/               — useAsync, useCurrentLocation
  tests/                 — render helpers (press/typeInto/findAll/flushAsync) +
                           fixtures (incl. fakeLocationClient) + mocks for
                           react-native/expo-status-bar/expo-secure-store/
                           expo-location/react-native-maps/expo-notifications/
                           expo-device/expo-constants (test infra only)
```

## Boundaries (what lives where)

| Concern        | Module                              | Default                                                                                                                                                                                                                                                                                                                                         |
| -------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API            | `src/api/client.ts` + `ride/api.ts` | Consumes `{ data }` / `{ error }` shared contracts; `authProvider` seam; 11 ride endpoints                                                                                                                                                                                                                                                      |
| Authentication | `src/auth/`                         | Concrete phone+OTP client (OD-005 resolved) — secure storage + backend validation; `AuthState` discriminated union                                                                                                                                                                                                                              |
| Realtime       | `src/realtime/`                     | `createSocketRealtimeClient` (OD-008 realtime half resolved, Phase 3.22) — authenticated Socket.io with reconnect; falls back to `unavailableRealtimeClient` (fail closed) with no realtime URL configured                                                                                                                                      |
| Push           | `src/notifications/`                | Expo Notifications + Expo Push Service (OD-008 push half resolved, Phase 3.23) — permission state, token registration tied to auth lifecycle, tap → notifications feed; fails closed (no-op) without a device/permission/EAS project id                                                                                                         |
| Maps/Location  | `src/location/`                     | `createDefaultLocationDependencies()` (Phase 3.19/3.20) wires `unavailableLocationClient` + `failClosedGeocodingProvider` + `failClosedRoutingProvider` when no Maps key is configured (fail closed, OD-007). Provider-neutral ports: `GeocodingProvider`, `RoutingProvider`, `LocationClient`. Map view renders a placeholder when unavailable |
| Google Maps    | `src/location/google-*-provider.ts` | Google Geocoding + Routes REST providers behind the ports (client-side, public restricted key); `polyline.ts` decodes Google polylines to `[lng, lat]` `LineString`                                                                                                                                                                             |
| Async UI       | `src/state/async.ts` + `useAsync`   | no global store                                                                                                                                                                                                                                                                                                                                 |
| Request state  | `src/ride/request-store.ts`         | session-local (no backend request-list endpoint); not persisted. Phase 3.21: My Requests offers Withdraw (PENDING) / Cancel participation (ACCEPTED) via `POST .../cancel`; a successful cancel updates the store to CANCELLED via `requestStore.updateStatus`                                                                                  |

## Auth flow

Phone entry (`requestOtp`) → OTP verification (`signIn(phone, otp)`, resend via
`requestOtp`) → authenticated shell. The bearer token lives only in
`expo-secure-store` (platform Keychain/Keystore) and in outgoing
`Authorization` headers; every failure is the generic "Authentication failed.
Sign in again." copy (no enumeration, no provider detail). Session restore
re-validates with the backend and fails closed (storage errors, expiry, or
server rejection all settle to `unauthenticated`).

## Ride flow

Discover (typed lat/lng/radius, or "Use my current location" to fill the
fields when permitted) → ride details → request seats → session request states
→ notifications (read + accept/reject decisions). Creator-only cancel on ride
details. **Lifecycle (Phase 3.21)** — the participant can Withdraw a PENDING
request or Cancel an ACCEPTED participation from My Requests
(`POST /rides/:rideId/requests/:requestId/cancel`); seats are released
server-side and the last confirmed participant's cancel reverts a CONFIRMED
ride to PUBLISHED (OD-002 time windows/grace periods remain OPEN).
**Matching (Phase 3.19)** — explicit user action to `POST /rides/match`
with pickup, destination, departure time, optional seats; server-controlled
thresholds (OD-004 resolved) return eligible matches with factor explanations.
No auto-switching from discovery to matching. **Maps (Phase 3.20)** — discovery
map with pickup/destination markers, address search on create-ride, and a
route preview (distance/duration) on ride details, all through provider-neutral
ports and failing closed without a Maps key.

## Configuration

Centralized in `src/config/env.ts` (read from `EXPO_PUBLIC_*` variables):

- `EXPO_PUBLIC_API_URL` — backend base URL (platform notes in `.env.example`)
- `EXPO_PUBLIC_REALTIME_URL` — reserved; realtime stays disabled by default
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` — public, Android/iOS-restricted Google
  Maps key used client-side for geocoding/routing/maps (Phase 3.20). Optional:
  without it, map features fail closed. Never use a server/API key here — the
  value is inlined into the app bundle by design (it is a public client key).

Never commit secrets. Only `EXPO_PUBLIC_*` values are inlined into the bundle.
**No MSG91/authentication secrets are configured on mobile** — auth keys live
backend-only. **No Google server-side secrets are configured on mobile** — the
Maps key is a public restricted client key; the backend never touches it.

## Scripts

| Command                                    | Purpose                            |
| ------------------------------------------ | ---------------------------------- |
| `pnpm --filter @ridepool/mobile start`     | Expo dev server                    |
| `pnpm --filter @ridepool/mobile lint`      | ESLint                             |
| `pnpm --filter @ridepool/mobile typecheck` | tsc --noEmit                       |
| `pnpm --filter @ridepool/mobile test`      | vitest (deterministic, no network) |

## Testing

Deterministic unit + render tests (vitest, Node environment): the API client
is tested with a mocked `fetch`, `RideApi` calls are pinned to exact paths and
bodies, and screen tests inject a typed fake `RideApi` with
`press`/`typeInto`/`flushAsync` helpers (`tests/render.tsx`). Location
behavior is tested through an injected fake `LocationClient`
(`tests/fixtures.ts`) with no GPS/network. Auth behavior is tested with
injected fake clients/storage and a fail-closed `expo-secure-store` mock
(`tests/mocks/expo-secure-store.ts`), so the default wiring settles
deterministically to `unauthenticated`. Component render tests use
`react-test-renderer` with minimal `react-native` / `expo-status-bar` /
`react-native-maps` / `expo-location` / `expo-notifications` / `expo-device` /
`expo-constants` mocks (`tests/mocks/`, aliased only under vitest — the
notification mocks are fail-closed by default, same convention as
`expo-secure-store.ts`). The Google Geocoding/Routes providers are tested
against a mocked `fetch` (exact URLs, headers, bodies, and normalized error
mapping); `decodePolyline` has its own unit tests. Push notifications
(`src/notifications/*.test.ts`) are tested with `vi.spyOn` against the aliased
`expo-notifications`/`expo-device` modules and a fake `ApiClient` — no real
device, no Expo servers. No network, no real sockets, no GPS, no live maps.

Note: `react-test-renderer` is deprecated upstream (React 19) and emits a
deprecation warning in render tests; it is used here as the deterministic Node
renderer. A maintained replacement (e.g. React Native Testing Library on a
vitest-compatible setup) can be adopted when available without changing the
test surface — see `docs/development/phase-3-13-notes.md` §13.
