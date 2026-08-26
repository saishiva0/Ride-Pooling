# Phase 3.10 — HTTP/API Boundary: Implementation Notes

> Status: Phase 3.10 — Implementation
> Records how the existing Ride Engine, notification, and Phase 3.9 auth
> foundations were exposed through a clean, versioned REST API. No domain or
> application logic was rewritten, no schema/migration/seed was changed, and
> **OD-005 (authentication method) stays OPEN** — there is no real
> authentication provider, no login/register, no tokens, and no sessions.
> Production fails closed until the approved mechanism lands.

## 1. Purpose and boundary

Phase 3.10 adds the HTTP/API boundary only:

```
HTTP Request → Route → Controller → Auth boundary → Application Service → Domain → Repository → PostgreSQL/PostGIS
```

Express stays an outer-layer concern: controllers never touch Prisma, never
call repositories, and contain no business rules (no state transitions, seat
calculations, matching, or notification logic). Every endpoint wraps ONE
existing application service.

## 2. Architecture

```
modules/
  api/                        shared HTTP plumbing
    async-handler.ts          Express 4 async rejection → next(err)
    parse.ts                  Zod safeParse → ValidationError (400)
    response.ts               { data } success envelope (shared contract)
  auth/http/
    auth.middleware.ts        HttpAuthenticator seam, fail-closed default,
                              test authenticator, createAuthMiddleware,
                              getAuthenticatedUser
  ride/http/
    ride.schemas.ts           Zod schemas (body/query/path)
    ride.controller.ts        thin handlers → application services
    ride.routes.ts            /api/v1/rides* routes
  notification/http/
    notification.schemas.ts   Zod schemas
    notification.controller.ts
    notification.routes.ts    /api/v1/notifications* routes
```

`app.ts` builds ONE auth middleware from the configured authenticator and
mounts both routers under `API_BASE_PATH` (`/api/v1`, from `@ridepool/shared`).
`GET /health` stays outside the versioned namespace, unchanged.

## 3. Routes

| Method | Path                                               | Auth         | Application service            | Success |
| ------ | -------------------------------------------------- | ------------ | ------------------------------ | ------- |
| POST   | `/api/v1/rides`                                    | ✅ creator   | `createRide`                   | 201     |
| GET    | `/api/v1/rides/discover`                           | ✅           | `discoverRides`                | 200     |
| POST   | `/api/v1/rides/match`                              | ✅ requester | `discoverRides` + `matchRides` | 200     |
| POST   | `/api/v1/rides/:rideId/requests`                   | ✅ requester | `createRideRequest`            | 201     |
| POST   | `/api/v1/rides/:rideId/requests/:requestId/accept` | ✅ creator   | `acceptRideRequest`            | 200     |
| POST   | `/api/v1/rides/:rideId/requests/:requestId/reject` | ✅ creator   | `rejectRideRequest`            | 200     |
| POST   | `/api/v1/rides/:rideId/cancel`                     | ✅ creator   | `cancelRide`                   | 200     |
| GET    | `/api/v1/notifications`                            | ✅ owner     | `listNotifications`            | 200     |
| PATCH  | `/api/v1/notifications/:notificationId/read`       | ✅ owner     | `markNotificationAsRead`       | 200     |
| PATCH  | `/api/v1/notifications/read-all`                   | ✅ owner     | `markAllNotificationsAsRead`   | 200     |

Notes:

- **No publish/expire endpoints.** Publication is not an implemented
  application service; expiration is a system operation (`expireRide` takes an
  injected reference time and is a future scheduler's job). Neither is exposed
  as a public user endpoint. No scheduler was created.
- **`GET /api/v1/rides/discover` is authenticated** — every business endpoint
  requires authentication (fail-closed posture). This is an API-boundary
  decision, not a product decision; flag for product if public discovery is
  wanted.
- **Matching requires the explicit OD-004 configuration** (`matching` block).
  OD-004 is OPEN, so no thresholds are defaulted (matches `matchRides`'s
  contract). The request also carries a `discovery` block (pickup point +
  search radius + optional limit) because `matchRides` consumes
  `DiscoveredRide[]` candidates from `discoverRides` — candidates cannot be
  invented.
- Notification list supports only `limit` (the application layer supports it).
  No `unreadOnly` filter and no cursor pagination were invented
  (`listNotifications` always returns `unreadCount`).

## 4. Request/response conventions

- JSON everywhere; `/api/v1` prefix; `Content-Type: application/json`.
- **Success:** `{ "data": ... }` — shared contract `ApiDataResponse`
  (`packages/shared/src/contracts/response.ts`), produced only by
  `api/response.ts`.
- **Error:** `{ "error": { code, message, field?, details? } }` — the existing
  `ApiErrorResponse` from the centralized error handler
  (`middleware/error-handler.ts`).
- Dates are ISO-8601 strings with offset in requests, parsed by Zod into
  `Date` at the boundary.

## 5. Authentication seam

OD-005 is OPEN — **no real authentication provider exists** and none was
implemented (no passwords, JWT, OAuth, sessions, OTP, or token storage). The
HTTP layer consumes the Phase 3.9 abstractions through
`auth/http/auth.middleware.ts`:

- `HttpAuthenticator` — the seam (credentials/header → `AuthenticatedUser`).
- `createAuthMiddleware(authenticator, verify?)` — resolves the identity,
  verifies the user exists via Phase 3.9 `verifyAuthenticatedIdentity`
  (default), and stores the immutable `AuthenticatedUser` on `res.locals`.
- `failClosedAuthenticator` — the **default**: every protected request returns
  a generic 401. A production app built without an explicit authenticator
  exposes nothing.
- `createTestAuthenticator()` — TEST/DEVELOPMENT-ONLY: reads the
  `x-test-user-id` header to establish an `AuthenticatedUser`. It is only
  active when explicitly injected (`createApp({ authenticator })`) and MUST
  never be wired in production. No password/token was invented to make tests
  pass.

Controllers obtain identity via `getAuthenticatedUser(res)` and pass
`identity.userId` as the application services' trusted `actorId`/
`requesterId`/`userId` — **never** from the request body. A caller cannot
submit `actorId=some-other-user` and have it trusted.

## 6. Authorization behavior

- Ownership is enforced by the existing application services
  (`acceptRideRequest`/`rejectRideRequest`/`cancelRide` check the creator;
  `markNotificationAsRead` checks the recipient) — these rules were NOT
  duplicated or moved into controllers.
- The Phase 3.9 guards (`assertRideCreator`, `assertRequestOwner`,
  `assertNotificationOwner`) remain the reusable boundary for the future API
  middleware/authorization layer; the existing inline service checks remain
  authoritative.
- Identity is immutable per request (`res.locals.authenticatedUser`), set once
  by the auth middleware before any controller runs.

## 7. Validation strategy

Zod at the HTTP boundary only (`ride.schemas.ts`, `notification.schemas.ts`,
parsed by `api/parse.ts`): required fields, primitive types, numeric parsing
(query params arrive as strings), ISO date parsing, and basic shape. Business
rules (coordinate bounds, seat/price ranges, ride states, OD-004 threshold
positivity) stay in the application/domain layer, which returns its own
`ValidationError`/`BusinessRuleError` — the HTTP layer never duplicates them.
Schema failures map to `ValidationError` (400) with `field` set to the first
issue's path.

## 8. Error mapping (centralized)

`middleware/error-handler.ts` (unchanged behavior, reused): AppErrors map to
their status/code; unknown errors become a generic `INTERNAL_ERROR` (500);
stack traces only in development. No Prisma errors, SQL, file paths, secrets,
or credentials ever reach HTTP responses (verified by
`middleware/error-handler.test.ts`, including a real `PrismaClientKnownRequestError`).

| Condition                      | Status | Code                       |
| ------------------------------ | ------ | -------------------------- |
| Malformed HTTP input           | 400    | `VALIDATION_ERROR`         |
| Missing/invalid authentication | 401    | `AUTHENTICATION_ERROR`     |
| Not the owner/creator          | 403    | `AUTHORIZATION_ERROR`      |
| Missing resource               | 404    | `NOT_FOUND`                |
| Duplicate active request etc.  | 409    | `CONFLICT`                 |
| Domain rule violation          | 422    | `BUSINESS_RULE_VIOLATION`  |
| Unexpected failure             | 500    | `INTERNAL_ERROR` (generic) |

**Behavior correction:** `notFoundHandler` previously rendered a placeholder
500 for unmatched routes; Phase 3.10 requires a correct 404, so it now throws
`NotFoundError` (404, `NOT_FOUND`). The single existing assertion in
`app.test.ts` was updated accordingly — this was a boundary correction
mandated by the phase, not a test weakened to pass.

## 9. CORS / body parsing

Unchanged from the existing pattern: `express.json()` is mounted; CORS is
enabled only when `CORS_ORIGIN` is configured (`config/env.ts` already has the
variable; `.env.example` documents it). No origins hardcoded, no new
infrastructure.

## 10. Shared contracts

- Reused: `API_BASE_PATH`/`HEALTH_PATH` (`api/paths.ts`), `ApiErrorBody`/
  `ApiErrorResponse` (`contracts/error.ts`).
- Added: `ApiDataResponse<T>` (`contracts/response.ts`) — the single success
  envelope, framework-independent, exported for the future mobile client.
  No other shared types were duplicated between backend/mobile/shared.

## 11. Testing

- **Unit (no DB):** `middleware/error-handler.test.ts` (full AppError mapping
  table, 500-safe generic responses, no Prisma leakage, stack exposure only in
  dev, notFoundHandler → 404); `auth/http/auth.middleware.test.ts` (identity
  resolution + storage, fail-closed 401, unknown-user 401, unexpected-error
  wrapping, test authenticator contract, `getAuthenticatedUser`).
- **HTTP integration (real Express + real PostgreSQL, supertest):**
  - `ride/http/ride.http.integration.test.ts` — create 201 + envelope, invalid
    body 400, bad date 400, unauthenticated 401, unknown-user 401, discovery
    200 + invalid query 400 + 401, match 200 (explicit OD-004 config) +
    missing config 400, request 201 / 422 (DRAFT ride) / 409 (duplicate) /
    404, accept 200 (PUBLISHED→CONFIRMED) / 403 (non-creator) / 404, reject
    200 / 403, cancel 200 / 403 / 404.
  - `notification/http/notification.http.integration.test.ts` — list 200 +
    limit/hasMore + malformed limit 400 + 401, mark-one read 200 + cross-user
    403 (row stays unread) + unknown 404, mark-all scoped + idempotent.
- The existing `app.test.ts` covers `GET /health` → 200 and the unknown-route
  → 404 correction.

How to run:

```bash
pnpm --filter @ridepool/backend test
pnpm --filter @ridepool/backend test:watch   # vitest watch
```

The HTTP integration tests need the dev database running
(`pnpm db:start`) with migrations applied.

## 12. Example development requests

All business routes require the TEST authenticator header only when the app
was created with `createTestAuthenticator()`. In production (default), every
protected route returns 401 — there is no way to authenticate until OD-005
lands.

```bash
# Create a ride (dev/test app only — header is the test seam)
curl -X POST http://localhost:4000/api/v1/rides \
  -H 'Content-Type: application/json' -H 'x-test-user-id: <user-id>' \
  -d '{"pickup":{"latitude":12.9716,"longitude":77.6412},"destination":{"latitude":12.9698,"longitude":77.75},"departureDateTime":"2026-09-01T10:00:00+05:30","totalSeats":3,"pricingType":"STANDARD","pricePerKm":4}'

# Discover
curl 'http://localhost:4000/api/v1/rides/discover?latitude=12.9716&longitude=77.6412&radiusMeters=5000' \
  -H 'x-test-user-id: <user-id>'

# Match (OD-004 config required)
curl -X POST http://localhost:4000/api/v1/rides/match \
  -H 'Content-Type: application/json' -H 'x-test-user-id: <user-id>' \
  -d '{"discovery":{"latitude":12.9716,"longitude":77.6412,"radiusMeters":5000},"destination":{"latitude":12.9698,"longitude":77.75},"preferredDepartureTime":"2026-09-01T10:00:00+05:30","requestedSeats":1,"matching":{"pickupRadiusMeters":5000,"departureTimeWindowMinutes":60,"destinationToleranceMeters":5000}}'

# Health (no auth, outside /api/v1)
curl http://localhost:4000/health
```

## 13. Files changed

- **New:** `modules/api/{async-handler,parse,response}.ts`,
  `modules/auth/http/auth.middleware.ts`,
  `modules/ride/http/{ride.schemas,ride.controller,ride.routes}.ts`,
  `modules/notification/http/{notification.schemas,notification.controller,notification.routes}.ts`,
  `middleware/error-handler.test.ts`,
  `modules/auth/http/auth.middleware.test.ts`,
  `modules/ride/http/ride.http.integration.test.ts`,
  `modules/notification/http/notification.http.integration.test.ts`,
  `packages/shared/src/contracts/response.ts`,
  `docs/development/phase-3-10-notes.md`.
- **Modified:** `app.ts` (mount `/api/v1` routers + `authenticator` option),
  `middleware/error-handler.ts` (notFoundHandler → 404),
  `app.test.ts` (unknown-route assertion → 404),
  `packages/shared/src/index.ts` (export response contract),
  `modules/README.md` (Phase 3.10 entry).
- **Schema/migration/seed:** none.

## 14. Open decisions remaining

- **OD-005 (authentication method)** — OPEN. No provider, no tokens, no
  passwords. Production API is fail-closed until resolved.
- OD-004 (matching thresholds) — OPEN; required per-call in the match request.
- OD-002 (expiration grace), OD-010 (verification) — OPEN; not touched.
- Publication of rides is not exposed (no application service exists); request
  cancellation/seat release remain later phases.

## 15. Assumptions

- All `/api/v1` business endpoints require authentication (fail-closed);
  discovery being authenticated is an API-boundary decision to confirm with
  product.
- The `x-test-user-id` seam is used ONLY by tests/development via explicit
  injection; production defaults to `failClosedAuthenticator`.
- The `{ data }` envelope (added to shared) is the success convention; the
  error envelope is unchanged.
- `notFoundHandler` rendering 404 (instead of the Phase 1 placeholder 500) is
  the correct REST behavior and is treated as the intended convention.

## 16. Limitations

- No real authentication — every protected endpoint returns 401 in production
  until OD-005 resolves.
- No publish endpoint, no expiration endpoint/scheduler, no request
  cancellation, no ride detail/list-my-rides endpoints (no application
  services exist for them).
- Notification list supports `limit` only (no `unreadOnly`, no cursor).
- Matching requires clients to supply the OD-004 configuration explicitly.
- Test authenticator trusts a header — never enable it outside tests/dev.

## 17. Future integration points

- **Auth (OD-005):** a concrete `HttpAuthenticator` (password/OTP/magic link
  or a vetted provider) plugs into `createApp({ authenticator })`; the
  middleware, controllers, and error mapping already support it unchanged.
- **Mobile:** the mobile client will call these routes with the future
  credential/token; `ApiDataResponse`/`ApiErrorResponse` shared contracts give
  it typed envelopes. Base URL helpers already exist in `apps/mobile/src/lib/api.ts`.
- **Real-time (Phase 3.11) and later phases** were NOT started.
