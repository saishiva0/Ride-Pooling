# Phase 3.9 — Authentication & Authorization: Implementation Notes

> Status: Phase 3.9 — Implementation
> Records how the provider-independent authentication & authorization
> foundation was built around the existing Ride Engine. The authoritative
> product context is `docs/planning/open-decisions.md` (OD-005), the PRD
> (`docs/product/product-requirements.md` FR-001), and
> `docs/architecture/module-boundaries.md` (§4.2 User & Authentication).
> **No product decision is resolved here: OD-005 (authentication method)
> stays OPEN, and no credential scheme, provider, token format, HTTP route,
> or mobile UI is implemented.**

## 1. Purpose and boundary

Phase 3.9 establishes WHO is making a request and WHETHER that user is
allowed to perform the operation — without building the HTTP API layer
(Phase 3.10), mobile auth UI (later), or changing Ride Engine business
behavior. The existing Ride Engine application services keep their trusted
`actorId`/`userId` input and their inline ownership rules; this phase builds
the reusable boundary those services (and the future API layer) will consume.

```
Credentials → authentication → authenticated identity → authorization → application service
```

Authentication must stay OUTSIDE the Ride domain: the engine must never
verify passwords, parse tokens, manage sessions, or read HTTP headers. All of
that lives behind the `Authenticator` seam (`auth/application/authenticator.ts`).

## 2. OD-005 status — OPEN (not resolved)

`docs/planning/open-decisions.md` OD-005 ("Authentication method: phone+OTP
vs email+password vs magic link") is **OPEN**, and the PRD leaves the method
open (FR-001). Per the phase spec:

- No external provider was chosen or integrated (no OAuth, Firebase Auth,
  Clerk, Auth0, Supabase Auth, Cognito, or any other).
- No provider was invented and no speculative production token architecture
  was implemented.
- Only **provider-independent foundations** were built (this module), and the
  unresolved decision is documented here and in `auth/README.md`.

**What remains unresolved:** the exact method (password / phone+OTP / magic
link / external provider), phone format (E.164), email/phone verification
requirements (OD-010), password policy, token/session format (JWT vs opaque
server-side sessions), and which environment variables the chosen method
needs. These are Phase 3.10+ decisions and must not be silently resolved.

## 3. Module layout

```
modules/auth/
  domain/
    identity.ts        — AuthenticatedUser / AuthenticationResult, factories, guards
    identifiers.ts     — normalizeEmail / normalizePhone
  application/
    authenticator.ts   — the Authenticator port (unimplemented seam; OD-005)
    authorization.ts   — assertRideCreator / assertRequestOwner / assertNotificationOwner
    verify-identity.ts — verifyAuthenticatedIdentity (DI, fail-closed)
  infrastructure/
    auth.repository.ts — findUserById (the only Prisma access)
```

## 4. Identity model

Provider-independent, minimal, Prisma-free (`auth/domain/identity.ts`):

```ts
AuthenticatedUser  { userId }        // the ONLY field
AuthenticationResult { user: AuthenticatedUser }
```

- `createAuthenticatedUser(userId)` is the only legitimate entry point; it
  rejects missing/blank/non-string ids (`ValidationError`).
- `isAuthenticatedUser(value)` is the structural guard the boundary uses to
  reject malformed input (fail closed).
- Identity carries nothing else: no credentials, hashes, tokens, provider
  data, or user profile fields. Tests assert the payload is exactly
  `{ userId }` (no sensitive field can leak through the result shape).

## 5. Credential handling

**No credentials exist.** OD-005 is open, so there are no password hashes,
OTP codes, magic-link tokens, or credential columns — and none were added
speculatively. `auth/application/authenticator.ts` defines the seam:

```ts
interface Authenticator {
  readonly method: string; // 'password' | 'phone-otp' | 'magic-link' ...
  authenticate(credentials: AuthCredentials): Promise<AuthenticationResult>;
}
```

The future concrete implementation owns credential shape/validation,
verification (e.g. constant-time password check via a modern KDF — never
MD5/SHA1/plain/reversible — when password auth is approved), and token/session
issuance per the approved architecture. Rules for that implementation
(recorded here so they are not lost):

- Hashing must be one-way; verification constant-time through the library.
- Hashes/credentials must never appear in API results, logs, or errors.
- Authentication failures must be generic (`AuthenticationError`, 401) — the
  boundary must never reveal whether a specific account exists.
- Secrets only via environment variables; never in source, Git, committed
  `.env`, or docs.

## 6. Identity vs business input (the critical boundary)

A future API caller must NOT be able to submit `actorId=some-other-user` and
have the system trust it. Authenticated identity must come from the
authentication boundary; business input carries only resource references
(`rideId`, `requestedSeats`, …).

Today the Ride Engine application services accept trusted `actorId`/`userId`
input and enforce their own inline rules (e.g. `acceptRideRequest`:
requester ≠ actor, actor == ride creator). Per the phase spec these were NOT
rewritten (that would break the unit/integration suites and domain purity).
Instead:

- `auth/application/authorization.ts` centralizes the SAME ownership rules as
  pure, reusable guards that take an `AuthenticatedUser` — never a raw id:
  - `assertRideCreator(actor, rideCreatorId, rideId)` — creator-only ops
    (manage own ride, decide on its requests, cancel it)
  - `assertRequestOwner(actor, requesterId, requestId)` — a user decides only
    on their own request
  - `assertNotificationOwner(actor, recipientId, notificationId)` — a user
    accesses only their own notifications
- All guards fail closed with a generic `AuthorizationError` (403).
- **Future API integration point (Phase 3.10):** the API layer resolves the
  presented credential/token through the `Authenticator`, obtains an
  `AuthenticatedUser`, and passes `identity.userId` into the application
  services. The guards are the reusable enforcement the middleware will use.
- The existing inline checks in `acceptRideRequest`/`rejectRideRequest`/
  `cancelRide`/notification services remain authoritative until then.

## 7. Identity verification service

`auth/application/verify-identity.ts` — `verifyAuthenticatedIdentity(identity)`
confirms the presented authenticated identity corresponds to a real user and
returns the `AuthenticationResult`. Behavior:

- Malformed input → generic `AuthenticationError` (401), no validation
  reflection, and the persistence layer is NOT called.
- Unknown user → identical generic `AuthenticationError` (no enumeration).
- Persistence failures → `InternalError` (500, `expose: false`), raw DB
  errors never reach the boundary.
- The result is exactly the presented identity — the store can confirm
  existence but can never substitute a different user.
- Persistence is dependency-injected (`findUserById` port), so the service is
  unit-testable without a database; the default wiring uses the repository
  inside a `prisma.$transaction`.

## 8. Authorization rules (recorded, not duplicated)

| Rule                                                                                                           | Guard                                                               |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Ride creator may manage their own ride / decide on its requests / cancel it                                    | `assertRideCreator`                                                 |
| A user may create their own request, may not act as the ride creator, may not decide on another user's request | `assertRequestOwner` (+ engine's self-decision `BusinessRuleError`) |
| A user may list / mark read only their own notifications                                                       | `assertNotificationOwner`                                           |

The Ride Engine's self-request/self-decision rule remains a **business** rule
(`BusinessRuleError`, 422) inside the engine — the guards do not duplicate it.

## 9. Security measures

- Minimal identity payload (only `userId`); nothing sensitive can leak.
- No plaintext credentials anywhere; no hashing implemented (nothing approved).
- Generic authentication failure messages; no account enumeration.
- Fail closed on malformed identity input.
- Ownership enforced with generic 403s; resource ids only in `details`.
- Raw Prisma/persistence errors never escape the application boundary.
- Secrets: none introduced; `.env.example` unchanged (`JWT_SECRET`,
  `JWT_EXPIRES_IN` remain inactive placeholders per
  `docs/development/environment.md`).

## 10. Environment configuration

No new environment variables were added — nothing was approved that needs a
secret. When OD-005 resolves, the chosen method will add only its required
variables to `apps/backend/.env.example` (never real values), following
`docs/development/environment.md`. Development credentials (if a method needs
them) will be clearly documented development-only values, never production
secrets.

## 11. Database / schema

**No schema change and no migration.** The Phase 2 `User` model
(`apps/backend/prisma/schema.prisma`) is untouched:

- `id` (cuid), `name`, `phone @unique?`, `email @unique?`, timestamps.
- The migration's `User_contact_required` check requires at least one of
  phone/email (verified by integration test).
- `phone`/`email` uniqueness + the contact check are the identifier
  foundation future login flows will key on; the auth boundary normalizes
  identifiers (`normalizeEmail`/`normalizePhone`) so these constraints behave
  consistently.
- No account-status field exists; when the approved architecture requires
  one (e.g. disabled accounts), it will be added as a minimal field in the
  phase that lands the mechanism. Until then the boundary has nothing to
  reject beyond a missing user.

`prisma migrate status`: **Database schema is up to date** (1 migration,
`20260813185022_phase2_domain_model`).

## 12. Testing

- **Unit (4 files, 31 tests, no DB):** `identity.test.ts` (creation, minimal
  payload, structural guards, identity isolation), `identifiers.test.ts`
  (email/phone normalization + rejection), `authorization.test.ts`
  (creator-only ops, requester restrictions, notification ownership,
  identity isolation across all guards, generic 403s),
  `verify-identity.test.ts` (valid identity resolution, generic failure for
  unknown user, malformed input fails safely WITHOUT touching persistence,
  store can never substitute a different user, persistence failures wrapped
  and not exposed).
- **Integration (1 file, 7 tests, real PostgreSQL):**
  `identity.integration.test.ts` — real-user resolution, unknown-user generic
  failure (no enumeration), malformed input fail-closed, duplicate email
  rejected, `User_contact_required` check enforced, phone-only/email-only
  accounts coexist, normalized identifiers persist consistently, duplicate
  phone rejected across visually different formatting.
- Existing suites unchanged and green: 517 tests → **555 tests / 42 files**.

## 13. Files changed

- **New (module):** `modules/auth/domain/{identity,identifiers}.ts`,
  `modules/auth/application/{authenticator,authorization,verify-identity}.ts`,
  `modules/auth/infrastructure/auth.repository.ts`, `modules/auth/README.md`.
- **New (tests):** the 4 unit + 1 integration test files in §12.
- **Modified:** `modules/README.md` (Phase 3.9 entry).
- **Schema:** none. **Migration:** none. **Seed:** unchanged (no credentials
  exist; OD-005 open).
- **Docs:** `docs/development/phase-3-9-notes.md` (this file).

## 14. Open decisions left untouched

- **OD-005 (authentication method)** — OPEN, as required. Nothing was
  silently resolved.
- OD-010 (verification requirements) — OPEN; affects the auth mechanism.
- OD-001/002/003/004/006/007/008/009/011–019 — untouched.

## 15. Assumptions

- `actorId`/`userId` in the Ride Engine and notification services remain
  trusted application input this phase; the API layer (Phase 3.10) will
  replace trusted input with authenticated identity via the `Authenticator`
  seam and the guards.
- Identifier normalization is deliberately minimal; full phone formatting
  (E.164) and email verification policy belong to the OD-005/OD-010 decision.
- The `User_contact_required` check and unique phone/email constraints are
  the intended identifier foundation (not a bug to work around).

## 16. Limitations

- No concrete authentication flow exists (OD-005 open) — nothing to log in
  with yet.
- No tokens/sessions; no expiry/revocation; no refresh semantics.
- No account-status/disabled-user rejection (no such field exists; will be
  added with the approved mechanism).
- No HTTP routes, no middleware, no mobile UI.
- The Ride Engine services still trust `actorId` until Phase 3.10 wires the
  boundary.

## 17. Future integration points

- **API (Phase 3.10):** `POST /api/v1/auth/*` will consume the `Authenticator`
  (concrete implementation per OD-005) → `AuthenticationResult` →
  `AuthenticatedUser`; auth middleware will resolve identity and pass
  `authenticatedUserId` into application services, using
  `auth/application/authorization.ts` guards for ownership. Error mapping
  already matches `docs/architecture/api-boundaries.md` §4
  (`AUTHENTICATION_ERROR` 401, `AUTHORIZATION_ERROR` 403).
- **Mobile:** the mobile client will obtain the credential/token from the
  future auth API; token storage, protected screens, and login/signup UI are
  explicitly deferred. `apps/mobile/src/lib/api.ts` remains the base-URL
  helper.
