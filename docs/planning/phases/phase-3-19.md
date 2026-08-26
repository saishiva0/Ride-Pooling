# Phase 3.19 — Matching (OD-004 Resolution + Mobile Matching Experience)

> Status: **COMMITTED**
> Resolves OD-004 with an approved V1 matching policy, converts the
> caller-supplied `MatchingConfiguration` into server-controlled approved
> defaults, keeps the deterministic Phase 3.4 matching engine, and delivers the
> mobile matching experience. No schema changes, no new entities, no matching
> persistence.

## 1. Objective

1. Resolve OD-004 canonically (approved thresholds, ranking, result limit,
   no-score decision, server-controlled configuration).
2. Convert the existing caller-supplied matching configuration into approved
   V1 server defaults.
3. Preserve the existing deterministic matching engine (Phase 3.4).
4. Complete the backend matching API behavior (no caller-controlled policy).
5. Complete the mobile matching experience (explicit user action, not
   auto-discovery).
6. Provide deterministic, explainable matching results (structured factor
   results).
7. Verify the full backend + mobile regression suite.

## 2. Resolved OD-004

`docs/planning/open-decisions.md` OD-004 is **RESOLVED**. Full decision record
lives there. Only OD-004 is resolved by this phase; OD-005 stays resolved;
OD-007 / OD-008 / OD-010 remain OPEN.

## 3. Matching thresholds

| Threshold             | Approved value                         |
| --------------------- | -------------------------------------- |
| Pickup search radius  | 5,000 meters (inclusive)               |
| Departure time window | ±60 minutes (inclusive)                |
| Destination tolerance | 5,000 meters straight-line (inclusive) |
| Maximum results       | 20 (server-owned)                      |

Units stay meters / minutes — no silent km conversion.

## 4. Ranking policy

1. Pickup distance ascending (primary).
2. Absolute departure-time difference ascending (secondary).
3. Ride ID ascending (final deterministic tie-break).

Deterministic for identical input + database state. Never random, never
database-row order.

## 5. No-score decision

No numeric relevance score in V1. The deterministic, explainable factor
results and proximity ranking are authoritative. A weighted score would
introduce arbitrary weighting without additional product evidence (ADR-007).

## 6. Result limit

Maximum 20 matching results. Server-owned via config
(`MATCHING_MAX_RESULTS`). Callers cannot override it; the client no longer
sends `discovery.limit` or any result cap on the match endpoint.

## 7. Explanation model

Each match carries the existing `FactorResult[]` from the matching domain:
per-factor `eligible`, measured `value`, `threshold`, and deterministic
`reason` (pickup distance, destination distance, departure minutes, seats,
status). No internal details, DB records, private data, or imaginary weights.

## 8. Backend scope

- Add server-controlled matching config (env vars with approved defaults).
- Build the approved `MatchingConfiguration` from centralized config.
- Remove `matching` (and `discovery.limit`) from `POST /api/v1/rides/match`;
  reject unknown/policy fields (strict schema).
- Apply the approved thresholds and the 20-result cap in the match handler.
- Keep the Phase 3.4 domain engine and its ANDed eligibility untouched.
- Authentication stays at the existing auth boundary (Phase 3.18).

## 9. Mobile scope

- `MatchRidesInput` no longer carries `matching` configuration or
  `discovery.limit` — the client sends user intent only.
- A matching screen (pickup / destination / departure time / requested seats)
  that is an explicit user action, distinct from plain discovery.
- Matching results show the ride plus the backend-provided factor reasons.
- Reuse `LocationClient` ("Use my current location"), `useAsync`, and the
  existing Loading/Error/Empty components and `MobileError` normalization.

## 10. Security rules

- HTTP callers can never provide pickup radius, time window, destination
  tolerance, weights, score, ranking, or result maximum. Such input is
  rejected (400).
- Identity always comes from the authenticated boundary; no `userId` /
  `actorId` is accepted from the body.
- No secrets, tokens, Prisma objects, SQL, or stack traces in responses.

## 11. Explicit out-of-scope

Maps provider, routing, geocoding, GPS provider, realtime, push
notifications, chat, payments, verification, offline sync, admin, analytics,
ML/AI matching, dynamic pricing, driver scoring, user reputation, surge logic,
route optimization, traffic-aware ETA, social matching, new preferences, new
database entities. These belong to later phases.

## 12. Dependencies

- Phase 3.4 matching domain (unchanged semantics).
- Phase 3.12 / 3.16 coordinate + distance foundations.
- Phase 3.18 authentication boundary.
- No new runtime dependencies.

## 13. Database impact

None. No schema changes, no migrations, no new tables, no matching
persistence, no seed changes.

## 14. Testing requirements

- Backend unit: defaults (5000 / 60 / 5000 / 20), boundary acceptance,
  just-outside rejection, no score, deterministic ranking, pickup priority,
  time secondary, ride-ID tie-break, max 20, structured explanations,
  malformed input, invalid coordinates.
- Backend HTTP: authenticated match, unauthenticated 401, validation 400,
  policy-override rejection (400), result envelope, determinism, max 20.
- Backend integration (real Postgres/PostGIS): eligible/excluded rides,
  distance/time boundaries, ordering, cleanup.
- Mobile: match API call (exact body, no policy), validation, loading,
  success, empty, error, explanation rendering, navigation.

## 15. Acceptance criteria

- OD-004 resolved in canonical documentation.
- 5 km / ±60 min / 5 km thresholds implemented (server-controlled).
- No numeric score; deterministic ranking (pickup → time → id); max 20.
- Client cannot override matching policy (rejected at the API boundary).
- Existing factor explanations remain authoritative.
- Backend matching API production-ready; mobile matching flow implemented.
- No maps, no realtime, no auth duplication, no schema changes, no migrations.
- Full regression green (backend + mobile), typecheck, lint, build, format,
  Prisma validate/migrate status, db:check, Expo config, live verification.
