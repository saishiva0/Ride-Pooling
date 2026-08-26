# Phase 3.16 — Mobile Location, GPS & Maps Foundation: Implementation Notes

> Status: Phase 3.16 — Implementation
> Builds the provider-neutral mobile device-location boundary (a `LocationClient`
> port, an explicit permission model, a validated-coordinate acquisition state,
> a `useCurrentLocation` hook) and integrates current location into the existing
> ride-discovery screen as an enhancement that never blocks the manual
> coordinate flow. No backend file, Prisma schema, migration, seed, API
> contract, or shared package was changed. OD-004, OD-005, OD-007, OD-008 and
> OD-010 remain OPEN and were NOT resolved; in particular **OD-007 (maps/GPS)
> stays OPEN** — no map provider, routing, geocoding, GPS/`expo-location`
> dependency, or API key was added.

## 1. Product decisions honored

- **OD-007 (maps/GPS) — OPEN, explicitly.** Phase 3.16 builds the seam through
  which a device provider will later plug in, but it does NOT select a
  provider: there is no `expo-location`, no native GPS call, no map SDK, no
  routing/geocoding, no background location, no location persistence, and no
  `EXPO_PUBLIC_*` configuration for any provider. The default `LocationClient`
  is `unavailableLocationClient`, which **fails closed** exactly like the
  auth/realtime seams from earlier phases. A real device adapter is only
  permitted once the repo carries a supported Expo dependency (matching the
  Phase 3.14/3.15 `unavailable*Client` precedent).
- **OD-004 (matching thresholds/weights) — OPEN.** Discovery remains
  plain-location (`GET /api/v1/rides/discover`); `matchRides` is still not
  wired to any default UI. Using current location only fills the coordinate
  fields; it never triggers matching.
- **OD-005 (authentication), OD-008 (realtime), OD-010 (verification) —
  OPEN, unchanged.** No socket, push, or verification flows were added.
- **Manual coordinates remain the primary flow.** Location is a convenience
  that populates the form; denial/unavailability renders a clear message and
  discovery keeps working exactly as before. Location NEVER auto-triggers
  discovery and never runs in the background.

## 2. What was NOT built (deliberate, for OD-007)

No `watchLocation`/subscription, no continuous tracking, no location history,
no geocoding/reverse-geocoding, no map rendering, no route drawing, no
accuracy/age filtering policy (none invented), no provider configuration, no
permissions in `app.json`/`app.config`, no new dependency, no network calls
from the location layer, and no fabricated/inferred positions ever.

## 3. Files created

```
apps/mobile/src/location/location.types.ts   — Coordinate, LocationReference, GeoJsonPoint
apps/mobile/src/location/coordinate.ts       — WGS84 bounds constants + validation predicates,
                                               asCoordinate, toGeoJsonPoint, asLocationReference,
                                               formatLocationReference (throws normalized MobileError)
apps/mobile/src/location/permission.ts       — LocationPermissionStatus + guards +
                                               locationPermissionMessage
apps/mobile/src/location/location-state.ts   — LocationState union + guards +
                                               locationAcquisitionMessage
apps/mobile/src/location/location-client.ts  — LocationClient port + unavailableLocationClient
apps/mobile/src/hooks/use-current-location.ts — useCurrentLocation(client) hook
```

Test files created: `location/coordinate.test.ts` (22), `location/permission.test.ts`
(7), `location/location-state.test.ts` (5), `location/location-client.test.ts`
(4), `hooks/use-current-location.test.tsx` (10),
`screens/rides/rides-home-screen.location.test.tsx` (8).

## 4. Files modified

- `apps/mobile/src/api/errors.ts` — extended `MobileErrorKind` (additive) with
  `'permission-denied' | 'permission-unavailable' | 'location-unavailable'`
  and stable user-facing messages (all ending ". You can still enter
  coordinates manually."); `errors.test.ts` extended (12 tests, +1).
- `apps/mobile/src/ride/validation.ts` — `parseDiscoveryForm`/`parseCoordinate`
  now import the WGS84 bounds constants and predicates from
  `location/coordinate.ts` instead of duplicating them; **all user-facing
  messages and all 13 existing tests are unchanged.**
- `apps/mobile/src/screens/rides/rides-home-screen.tsx` — added the optional
  `locationClient` prop (default `unavailableLocationClient`), the "Use my
  current location" action, a deterministic location message line, and the
  notice/denial/unavailable/requesting/success states; discovery behavior is
  unchanged (still "Find rides" only, manual coords always work).
- `apps/mobile/src/navigation/app-navigator.tsx` — `AppNavigatorProps` gains
  `locationClient?: LocationClient` (default `unavailableLocationClient`),
  forwarded to `RidesHomeScreen`.
- `apps/mobile/src/components/ride-card.tsx` and
  `apps/mobile/src/screens/rides/ride-details-screen.tsx` — pickup/destination
  render through `formatLocationReference(asLocationReference(...))` (label, or
  "lat, lng"); output is byte-for-byte unchanged (existing tests untouched).
- `apps/mobile/tests/render.tsx` — added `flushAsync()` (12 microtask turns
  inside `act`) for multi-`await` permission → location chains.
- `apps/mobile/tests/fixtures.ts` — added `fakeLocationClient(options)` with
  mock methods (deterministic; call counts assertable).

No backend file, Prisma schema, migration, seed, environment file, or shared
package was modified.

## 5. The `LocationClient` port (provider-neutral, fail closed)

```ts
interface LocationClient {
  getPermissionState(): Promise<LocationPermissionStatus>;
  requestPermission(): Promise<LocationPermissionStatus>;
  getCurrentLocation(): Promise<Coordinate>;
}
```

- The port is the ONLY way screens interact with device location; screens never
  call Expo Location / native APIs (same pattern as the `AuthClient` /
  `RealtimeClient` seams).
- `unavailableLocationClient` fails closed: permission resolves `'unavailable'`,
  `requestPermission()` resolves `'unavailable'` (deterministic no-op),
  `getCurrentLocation()` rejects with `MobileError('location-unavailable', ...)`.
- There is intentionally NO `watchLocation` in the port — OD-007's tracking
  questions stay out of scope.

## 6. Permission model

`LocationPermissionStatus = unknown | requesting | granted | denied | unavailable`.

- `unknown` is the initial state before the client reports.
- `unavailable` covers "no GPS / unsupported platform / no provider configured"
  and is the fail-closed default.
- `locationPermissionMessage` returns deterministic copy for `denied`,
  `unavailable`, and `requesting`, and `null` for `unknown`/`granted`.
- Denial/unavailability messages explicitly point back at manual coordinates
  so discovery is never blocked.

## 7. Acquisition state

`LocationState = idle | requesting | success { coordinate } | error { MobileError }`.

- Acquisition is INDEPENDENT of permission: `requesting` is on-demand only,
  never a background/continuous subscription.
- `success` always carries a validated coordinate — the hook validates through
  `coordinate.ts` before entering `success`, so a NaN/±Infinity/out-of-range
  reading becomes a normalized `validation` error, never a fake position.
- `isLocationSuccess` also refuses a bare `{ status: 'success' }` (belt and
  suspenders against rendering an empty position).

## 8. Coordinate rules (mobile mirror of the authoritative Phase 3.12 rules)

- Latitude ∈ [-90, 90], longitude ∈ [-180, 180], finite only (NaN and ±Infinity
  rejected) — identical to `apps/backend/src/modules/location/domain/coordinate.ts`.
- `@ridepool/shared` has no location contracts and the backend module imports
  backend-only `lib/errors.js`, so the rules live once on mobile in
  `location/coordinate.ts` (documented as a structurally-compatible local
  mirror) and are REUSED by `ride/validation.ts` — no duplicated formulas.
- `toGeoJsonPoint` emits `{ type: 'Point', coordinates: [longitude, latitude] }`
  (GeoJSON order); the serialization-boundary ordering is regression-tested.
- Valid coordinates pass through unchanged: no rounding, truncation, or
  precision policy (none invented).

## 9. `useCurrentLocation(client)` hook behavior

- On mount: reads `getPermissionState()` once (fail-closed to `unavailable`);
  it does NOT acquire location on mount (privacy test pins this).
- `requestPermission(): Promise<LocationPermissionStatus>` — reports the
  client's answer; a throwing request fails closed to `unavailable`.
- `getCurrentLocation(): Promise<Coordinate>` — re-entrancy guarded by a ref
  (a second call while in flight is ignored — no double GPS), returns
  `null` only on the fail-closed path, throws `MobileError('validation', ...)`
  for an invalid reading, and never auto-retries (a failing acquisition stays
  errored after one call; an explicit retry is user-initiated).

## 10. Rides-home integration rules

- "Use my current location" is an explicit action; it requests permission when
  needed, then populates Latitude/Longitude.
- Location NEVER triggers discovery automatically (no hidden network calls);
  "Find rides" remains the explicit action and radius is still required.
- The location message line is deterministic:
  acquisition-requesting → acquisition error (`mobileErrorMessage`) → notice
  ("Current location added to the form.") → permission message fallback.
- A denial or acquisition failure leaves the fields untouched and discovery
  fully functional.

## 11. Test matrix (deterministic; no GPS, no network)

- `coordinate.test.ts` — WGS84 boundaries (±90/±180, 0,0), NaN/±Infinity,
  one-axis-invalid pairs, `assertValidCoordinate` field paths, pass-through
  without precision policy, GeoJSON `[lng, lat]` ordering regression, label
  handling in `asLocationReference`/`formatLocationReference`.
- `permission.test.ts` — five states, guards, message determinism, no
  native/provider text leak.
- `location-state.test.ts` — union states, guards, success-requires-coordinate,
  `locationAcquisitionMessage`.
- `location-client.test.ts` — fail-closed default: `unavailable` permission,
  no-op request, `location-unavailable` rejection, no fabrication.
- `use-current-location.test.tsx` — unknown/idle initial, no mount acquisition,
  idle→requesting→success, re-entrancy (one call while in flight), NaN→
  validation error, native error → normalized `unknown` (no raw leak),
  fail-closed rejections, no auto-retry, explicit retry, permission denied and
  permission-throws→unavailable.
- `rides-home-screen.location.test.tsx` — default fail-closed message, location
  populates fields, no auto-discovery, no background acquisition, denied →
  message + manual flow still works, normalized acquisition error once + no
  auto-retry + manual flow works, "Find rides" sends the acquired coordinate,
  permission routed through the injected client.
- `errors.test.ts` — the three new kinds map to their stable messages.

## 12. Runbook (exact commands, all green)

```
pnpm --filter @ridepool/mobile typecheck   # tsc --noEmit (strict) — clean
pnpm --filter @ridepool/mobile lint        # eslint . — clean
pnpm --filter @ridepool/mobile test        # vitest run — 225 passed / 32 files (run twice, deterministic)
pnpm --filter @ridepool/backend typecheck  # clean (untouched)
pnpm --filter @ridepool/backend lint       # clean (untouched)
pnpm --filter @ridepool/backend test       # 701 passed / 56 files (unchanged)
pnpm --filter @ridepool/backend exec prisma validate      # schema valid
pnpm --filter @ridepool/backend exec prisma migrate status # up to date
pnpm --filter @ridepool/backend db:check   # DB connectivity OK
pnpm format:check                          # all files Prettier-clean
pnpm --filter @ridepool/mobile exec expo config --type public  # resolves cleanly
```

Mobile counts moved from **169 tests / 26 files** (end of Phase 3.15) to
**225 tests / 32 files**.

## 13. Open decisions (unchanged, all remain OPEN)

- OD-004 matching thresholds/weights — still not defaulted.
- OD-005 authentication mechanism — still fail-closed `noAuthHeadersProvider`.
- OD-007 maps/GPS — still OPEN; this phase added the boundary, not a provider.
- OD-008 realtime — still fail-closed `unavailableRealtimeClient`.
- OD-010 verification — still absent.

## 14. Known limitations

- Current location is not persisted, not shared with the backend, and not used
  for matching (OD-004/OD-007 gate those).
- On-device location requires a real `LocationClient` implementation, which the
  repo deliberately does not yet contain.
- `react-test-renderer` deprecation warning persists (unchanged from Phase
  3.13/3.15); see Phase 3.13 notes §13.

## 15. What a later phase must decide (future work)

- Which Expo location dependency to adopt (needed before a real device
  adapter) and whether to add map/routing/geocoding SDKs (OD-007).
- Whether current location should seed a "nearest rides" or OD-004-matched
  experience, and the accuracy/recency policy for filtering readings.
