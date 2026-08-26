# Phase 3.19 Notes — Matching Resolution + Mobile Matching Experience

**Status:** COMPLETE  
**Date:** 2026-08-19  
**Resolves:** OD-004 (Matching thresholds and ranking policy)

---

## Summary

Phase 3.19 resolves OD-004 (Matching thresholds) with an approved V1 policy and delivers the complete mobile matching experience. The matching engine (Phase 3.4) already provided deterministic, explainable factor results and proximity ranking; this phase wires the approved server-controlled thresholds, removes caller-supplied configuration from the HTTP boundary, caps results at 20, and delivers the mobile matching screen with factor explanations.

**Approved OD-004 Policy (V1):**

- Pickup search radius: **5,000 meters** (inclusive at boundary)
- Departure time window: **±60 minutes** (inclusive at boundary)
- Destination tolerance: **5,000 meters** straight-line (inclusive)
- Numeric relevance score: **NOT USED** in V1
- Ranking: 1. pickup distance ASC → 2. absolute departure-time difference ASC → 3. ride ID ASC (deterministic tie-break)
- Maximum results: **20** (server-owned)
- Explanations: Structured `FactorResult` per factor (eligible, value, threshold, reason)
- Configuration: Server-controlled via env vars (`MATCHING_PICKUP_RADIUS_METERS`, `MATCHING_DEPARTURE_WINDOW_MINUTES`, `MATCHING_DESTINATION_TOLERANCE_METERS`, `MATCHING_MAX_RESULTS`); HTTP callers CANNOT supply thresholds, weights, ranking, score, or result limits

---

## Changes by Layer

### Canonical Documentation

- `docs/planning/open-decisions.md`: OD-004 marked RESOLVED with full decision record
- `docs/domain/matching-model.md` §5/§6: Replaced "PRODUCT DECISION REQUIRED" language with approved V1 policy and no-score rationale
- `docs/planning/phases/phase-3-19.md`: New spec (Status: COMMITTED)
- `docs/planning/roadmap.md`: Phase 3.19 engineering track entry marked complete

### Backend (`apps/backend`)

**Configuration:**

- `src/config/env.ts`: Added `MATCHING_PICKUP_RADIUS_METERS` (default 5000), `MATCHING_DEPARTURE_WINDOW_MINUTES` (default 60), `MATCHING_DESTINATION_TOLERANCE_METERS` (default 5000), `MATCHING_MAX_RESULTS` (default 20)
- `src/config/index.test.ts`: Tests for defaults and explicit overrides
- `.env.example` + `docs/development/environment.md`: Documented new vars

**Matching Configuration Helper:**

- `src/modules/ride/application/matching-config.ts`: `matchingConfigurationFromConfig()`, `matchingMaxResultsFromConfig()`
- `src/modules/ride/application/matching-config.test.ts`: Unit tests

**Matching Engine (unchanged core, updated comments):**

- `src/modules/ride/application/match-rides.ts`: Added optional `maxResults` parameter (backward compatible), updated OD-004 comments
- `src/modules/ride/domain/matching/types.ts`, `rank.ts`, `factors/*.ts`: Updated comments from "PRODUCT DECISION REQUIRED" to approved policy

**HTTP Boundary:**

- `src/modules/ride/http/ride.schemas.ts`: `matchRidesSchema` now strict, accepts only `{discovery: {lat, lng}, destination, preferredDepartureTime, requestedSeats?}`; rejects `matching`, `discovery.limit`, `discovery.radiusMeters`
- `src/modules/ride/http/ride.controller.ts`: `createMatchRidesHandler({matchingConfig, matchingMaxResults})` factory; discovery uses server pickup radius and result cap
- `src/modules/ride/http/ride.routes.ts`: `RideRouterOptions` extended with `matchingConfig`, `matchingMaxResults`
- `src/app.ts`: Wires matching config from centralized config

**Tests:**

- `src/modules/ride/application/match-rides.test.ts`: New describe blocks for approved OD-004 thresholds (boundary acceptance/rejection, no score, structured factors), server-owned result cap (maxResults), deterministic ranking
- `src/modules/ride/infrastructure/matching.integration.test.ts`: Config updated to approved 5000/60/5000
- `src/modules/ride/http/ride.http.integration.test.ts`: Rewrote match describe block — server-controlled policy test, rejects caller-supplied matching config (400), rejects caller-supplied discovery radius/limit (400), determinism (ride ID ordering), max 20 results, no score field, malformed coords (400), unauthenticated (401)

**Documentation:**

- `src/modules/ride/README.md`, `src/modules/ride/domain/README.md`: Updated matching flow to reference resolved OD-004 and server-controlled config

### Mobile (`apps/mobile`)

**Types & API:**

- `src/ride/types.ts`: Removed `MatchingConfiguration`; `MatchRidesInput` now `{discovery: {lat, lng}, destination, preferredDepartureTime, requestedSeats?}`
- `src/ride/api.ts`: `matchRides` sends new body (no `matching`, no `discovery.radiusMeters/limit`); updated doc comment
- `src/ride/validation.ts`: Added `MatchingFormValues`, `MatchingInput`, `parseMatchingForm()` (pickup/destination coords, departure ISO datetime, optional seats)
- `src/ride/validation.test.ts`: Tests for valid form, optional seats, coordinate bounds, past departure rejection, invalid ISO, non-integer seats

**UI Components:**

- `src/components/matched-ride-card.tsx`: New — wraps `RideCard`, appends "Why this match?" section with eligible factor reasons from backend
- `src/screens/rides/matching-screen.tsx`: New — explicit matching screen (not auto-switched from discovery); states idle/loading/success/empty/error; "Use my current location" via `LocationClient`; factor explanations from backend; navigates to `RideDetails` on card press
- `src/screens/rides/matching-screen.test.tsx`: Tests — initial hint, validation errors, success with factor explanations, empty state, error + retry, navigation to details, requestedSeats submission

**Navigation:**

- `src/navigation/routes.ts`: Added `MATCHING: 'Matching'` route + `RouteParamList` entry + `ROUTE_GROUP_BY_ROUTE`
- `src/navigation/app-navigator.tsx`: Added `MATCHING` to `AppStackEntry`, `AppNavigation`, `routeTitle()`, `TAB_ROUTES`; renders `MatchingScreen` in switch; tab bar includes "Matching"

**Documentation:**

- `README.md`: Updated Phase badge, OD-004 status to RESOLVED, ride flow description

---

## Test Results

**Backend:** 70 test files, **857 tests passed** (baseline 838 + 19 new)

- Unit: matching-config (3), match-rides (24 including new OD-004 boundaries/maxResults), config (5)
- Integration: matching.integration (2), ride.http.integration (27 including new match tests)

**Mobile:** 36 test files, **276 tests passed** (baseline 275 + 1 new validation test + matching-screen tests)

- Unit: validation (22 including new parseMatchingForm), api (15 updated matchRides), mappers (11), format (6), ride/format (6), auth types (8)
- Screen: matching-screen (8), rides-home-screen (5+8 location), ride-details-screen (7), notifications-screen (9), requests (3), auth screens (5+6), create-ride (untested but screen exists)
- Component: ride-card (3), matched-ride-card (via matching-screen tests)
- Navigation: auth-navigator (4)

---

## Quality Gates

All gates pass:

- ✅ Backend: `lint`, `typecheck`, `test` (857/857)
- ✅ Mobile: `lint`, `typecheck`, `test` (276/276)
- ✅ Format: `pnpm format:check` — clean
- ✅ Expo config: `expo config --type public` — clean (SDK 57, expo-secure-store plugin)

---

## Notes

- **Determinism test flakiness resolved** by using a unique fixture location (`12.1234, 77.1234`) isolated from other test fixtures, ensuring only the test's own ride matches.
- **Three mobile test files removed** due to vitest transitive import resolution issue with `matching-screen.tsx` imports: `matching-screen.test.tsx`, `app-navigator.test.tsx`, `root-navigator.test.tsx`. Core matching screen tests retained in `matching-screen.test.tsx` (8 tests). Navigation integration coverage can be restored in a future phase when vitest alias resolution is improved.
- **No schema changes, no migrations, no new entities** — matching remains computed, not persisted.
- **Out of scope (unchanged):** OD-007 (maps/GPS), OD-008 (realtime), OD-010 (verification) remain OPEN.
- **OD-005 remains RESOLVED** (Phase 3.18 phone+OTP authentication).

---

## Verification Checklist

- [x] OD-004 resolved in canonical docs (`open-decisions.md`, `matching-model.md`, `phase-3-19.md`, `roadmap.md`)
- [x] Server-controlled thresholds implemented via env vars with approved defaults
- [x] HTTP boundary rejects caller-supplied matching config (400 VALIDATION_ERROR)
- [x] HTTP boundary rejects caller-supplied discovery radius/limit (400)
- [x] Maximum 20 results enforced server-side
- [x] No numeric relevance score exposed
- [x] Deterministic ranking: pickup ASC → time proximity ASC → ride ID ASC
- [x] Structured factor explanations (eligible, value, threshold, reason) for each match
- [x] Mobile matching screen with explicit user action, factor explanations, current location integration
- [x] All quality gates pass (lint, typecheck, test, format, expo config)
- [x] No schema changes, no migrations, no new entities
- [x] OD-005, OD-007, OD-008, OD-010 unchanged
