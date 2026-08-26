# Backend Modules

This directory will contain the business modules of the RidePool modular
monolith, per `docs/architecture/module-boundaries.md`.

Future modules (Phase 2+):

- `auth` — authentication
- `users` — user profiles
- `ride` — Ride Engine (creation, lifecycle, requests, seats, pricing)
- `matching` — discovery and matching
- `notifications` — notifications
- `communication` — ride chat (V1.1 candidate)
- `safety` — safety & trust
- `admin` — moderation (future)

Phase 1 intentionally contains only the `health` module (non-versioned).

**Phase 3.1** adds `ride/domain/` — the pure ride lifecycle state machine
and ride field validation rules (no API, no controllers, no routes, no
persistence orchestration yet). See `ride/domain/README.md` for details.

**Phase 3.2** adds `ride/application/` (the `createRide` use case) and
`ride/infrastructure/` (transactional Prisma persistence for Ride
creation). See `ride/README.md` for the module layout and creation flow.
Still no API, controllers, routes, or authentication. All other Ride
Engine responsibilities (discovery, matching, requests, seat management,
pricing calculation, notifications) remain unimplemented.

**Phase 3.3** adds ride discovery to `ride/application/discover-rides.ts`
(the `discoverRides` use case) and `ride/infrastructure/ride.repository.ts`
(the PostGIS `discoverNearbyRides` query). Discovery is candidate
retrieval only — no matching, ranking, requests, seat reservation, API,
or authentication. See `ride/README.md`.

**Phase 3.4** adds ride matching on top of discovery: `ride/application/match-rides.ts`
(the `matchRides` use case) plus the pure matching domain under
`ride/domain/matching/` (five documented factors, eligibility evaluation,
deterministic ranking). Matching consumes discovery output (`DiscoveredRide[]`),
is synchronous and side-effect free, and ends at `MatchedRide[]` — no
requests, no seat reservation, no API. See `ride/README.md`.

**Phase 3.5** adds ride request creation: `ride/application/create-ride-request.ts`
(the `createRideRequest` use case) plus the pure request rules under
`ride/domain/request-rules.ts`. Request creation validates requester/ride
existence, the self-request rule, requestable ride states, seat availability,
and duplicate active requests, then persists a `PENDING` `RideRequest` in one
transaction (the Phase 2 partial unique index is the race safety net). It is
read-only toward Ride/Participant data and ends at a pending request — no
accept/reject, no seat reservation, no API. See `ride/README.md`.

**Phase 3.6** adds request decisions: `acceptRideRequest` / `rejectRideRequest`
with transactional participant creation, seat allocation, and the first-accept
PUBLISHED → CONFIRMED transition. **Phase 3.7** adds `cancelRide` / `expireRide`
(ride lifecycle operations, `FOR UPDATE` ride-row locking). See
`ride/README.md` and `docs/development/phase-3-6-notes.md` /
`phase-3-7-notes.md`.

**Phase 3.8** adds the persistent in-app notification foundation:
`notification/` (domain rules, application use cases, Prisma repository) plus
Ride Engine wiring — successful request create/accept/reject and ride
cancel/expire/confirm operations persist their notifications atomically in the
same transaction. No push delivery, auth, UI, or API. See
`notification/README.md` and `docs/development/phase-3-8-notes.md`.

**Phase 3.9** adds the authentication & authorization foundation: `auth/`
(provider-independent identity types, identifier normalization, the
`Authenticator` port, reusable ownership guards, and the identity verification
service). No credentials, tokens, providers, or HTTP routes existed at this
phase — it built the boundary the API layer consumes. No schema change. See
`auth/README.md` and `docs/development/phase-3-9-notes.md`.

**Phase 3.10** adds the HTTP/API boundary: versioned REST routes under
`/api/v1` (ride create/discover/match/request/accept/reject/cancel and
notification list/mark-read/mark-all) that wrap the existing application
services through thin controllers. Controllers contain no business logic —
they read the request, parse with Zod (`api/` helpers), take identity from the
HTTP authentication seam (`auth/http/auth.middleware.ts`), and delegate to the
services. The default authenticator was fail-closed at this phase; only tests
injected the explicit `createTestAuthenticator`. See `ride/http/`,
`notification/http/`, `docs/development/phase-3-10-notes.md`.

**Phase 3.11** adds the realtime layer: `realtime/` (typed event contract,
draft→event mapping, `EventPublisher` abstraction + registry, Socket.io
infrastructure). Socket.io lives ONLY in `infrastructure/` and the HTTP
boundary; the domain/application layers depend only on the framework-
independent `EventPublisher`. The five ride use cases (request/accept/reject/
cancel/expire) publish events only AFTER their transaction commits — never
inside it — and delivery is best-effort, so a failed or rolled-back
transaction emits nothing. Recipients are derived from the
Phase 3.8 notification mapping, which remains the authoritative recipient
model; persistent notifications stay authoritative (offline clients use
`GET /api/v1/notifications`). Attached behind `SOCKET_ENABLED` (default off)
on path `/ws`. See `realtime/README.md` and
`docs/development/phase-3-11-notes.md`.

**Phase 3.12** adds the Location & Maps foundation: `location/` (provider-
independent coordinate types & centralized validation, the distance
abstraction reusing the Phase 3.4 great-circle implementation, and the
routing/geocoding provider seams). OD-007 (map provider) stays OPEN: no
provider is selected, no SDK, no API keys, no env vars, no network calls —
the default providers fail closed with provider-independent errors built on
`ExternalServiceError`. Coordinate predicates were centralized into
`location/domain/coordinate.ts` and are re-exported by the ride rules (same
behavior, single implementation). No schema change, no HTTP endpoints, no
mobile UI. See `location/README.md` and
`docs/development/phase-3-12-notes.md`.

**Phase 3.18** RESOLVES OD-005 and implements the real phone + OTP
authentication: `auth/` now contains the MSG91 OTP provider
(`infrastructure/msg91-provider.ts`, backend-owned verification), the
in-memory OTP rate limiter, the session domain/service (opaque 32-byte
base64url tokens, SHA-256-hashed at rest, 30-day TTL, server-revocable), the
`AuthSession` Prisma model (migration
`20260819114404_phase_3_18_auth_sessions`), and the HTTP routes
`POST /auth/request-otp`, `POST /auth/verify-otp`, `GET /auth/me`,
`POST /auth/logout`. The default HTTP and socket authenticators are now the
real bearer authenticator over the session service (tests still inject
`createTestAuthenticator`). Every outcome is generic — no enumeration, no
provider leaks, fail closed without `MSG91_AUTH_KEY`. See `auth/README.md`,
`docs/development/phase-3-18-notes.md`, and
`docs/planning/open-decisions.md`.
