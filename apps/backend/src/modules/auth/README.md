# Auth Module

Authentication & authorization (Phase 3.9 foundation; **Phase 3.18 — OD-005
resolved**).

**OD-005 (authentication method) was RESOLVED in Phase 3.18** in favor of
phone + OTP via **MSG91 SendOTP** with backend-owned verification and opaque
bearer sessions (`docs/planning/open-decisions.md`). The module now implements
the real mechanism end to end:

- **Request OTP** — `POST /auth/request-otp` (phone → MSG91 SMS; generic
  success, rate-limited).
- **Verify OTP** — `POST /auth/verify-otp` (phone + OTP validated against
  MSG91 server-side; creates the user on first sign-in; issues an opaque
  session).
- **Session** — `GET /auth/me` (restores/validates the session) and
  `POST /auth/logout` (revokes it). Tokens are 32 random bytes base64url;
  only their SHA-256 hash is stored (`AuthSession`), default TTL 30 days.
- **Protected resources** — the bearer `Authenticator` is the default
  HTTP/socket authenticator; no credentials are ever caller-supplied.

Every outcome is generic: no enumeration, no provider-message leaks, and MSG91
transport failures are never exposed. The provider fails closed when
`MSG91_AUTH_KEY` is unset.

## Layout

```
modules/auth/
  domain/        identity.ts        — AuthenticatedUser / AuthenticationResult
                 identifiers.ts     — email/phone normalization
                 phone.ts           — parseE164Phone / toProviderPhone (+91 default)
                 session-token.ts   — generateSessionToken / hashSessionToken / expiry
  application/   authenticator.ts   — the Authenticator port (now backed by
                                      bearer sessions)
                 authorization.ts   — reusable ownership guards
                 verify-identity.ts — identity verification service (DI)
                 otp-provider.ts    — OtpProvider port + request/verify limits
                 rate-limiter.ts    — in-memory OTP rate limiting
                 session-service.ts — session issue / restore / revoke
                 auth-dependencies.ts — shared config + dependency composition
                 request-otp.ts     — requestOtp service
                 verify-otp.ts      — verifyOtp service (user creation + session)
  infrastructure/auth.repository.ts — findUserById (Prisma)
                 session.persistence.ts — AuthSession tx persistence + upsertUserByPhone
                 msg91-provider.ts  — MSG91 SendOTP / verifyRequestOTP / retryotp
                 fake-otp-provider.ts — deterministic provider for tests
  http/          auth.middleware.ts — getAuthenticatedUser (request-context identity)
                 bearer-authenticator.ts — getBearerToken + createBearerTokenAuthenticator
                 auth.schemas.ts    — requestOtpSchema / verifyOtpSchema
                 auth.controller.ts — requestOtp / verifyOtp / me / logout
                 auth.routes.ts     — the four /auth routes
```

## What the module provides

1. **Identity types** (`domain/identity.ts`) — the minimal,
   provider-independent `AuthenticatedUser { userId }` and
   `AuthenticationResult`. `createAuthenticatedUser` is the only legitimate
   entry point; `isAuthenticatedUser` rejects malformed shapes (fail closed).
2. **Identifier normalization** (`domain/identifiers.ts`) — email
   (trim + lowercase) and phone (trim + strip separators) normalization so
   uniqueness behaves consistently.
3. **Phone canonicalization** (`domain/phone.ts`) — bare 10-digit numbers
   default to the `+91` country code; `normalizePhone` (Phase 3.9) remains the
   single normalization seam for lookup/uniqueness.
4. **Authorization boundary** (`application/authorization.ts`) — pure guards
   for the ownership rules: `assertRideCreator`, `assertRequestOwner`,
   `assertNotificationOwner`. All fail closed with `AuthorizationError` (403)
   and take an `AuthenticatedUser`, never a raw id.
5. **Authenticator port** (`application/authenticator.ts`) — the seam
   implemented in Phase 3.18 by `createBearerTokenAuthenticator` (HTTP and
   WebSocket); tests still use `createTestAuthenticator()`.
6. **Session security** — opaque 32-byte base64url tokens, SHA-256-hashed at
   rest, TTL-capped, server-revocable. Leaked DB rows cannot replay sessions.
7. **Rate limiting** — OTP request 3/10 min and verify attempts 5/10 min per
   phone (in-memory; single-instance limitation).

## Env configuration (all optional)

`MSG91_AUTH_KEY` (provider fails closed when unset), `MSG91_SENDER_ID`
(default `SMSIND`), `MSG91_BASE_URL`, `MSG91_OTP_EXPIRY_MINUTES` (5),
`MSG91_OTP_LENGTH` (6), `SESSION_TTL_DAYS` (30). See
`docs/development/environment.md`.

## What this module does NOT do

- No email/password, magic links, Firebase/Auth0/Clerk, or Apple/Google
  sign-in (OD-005 resolved to MSG91 only).
- No refresh-token rotation, no multi-device session management UI, no
  profile/name flow (`name: ''` for new users), no MSG91 webhooks.
- No OTP retry counters persisted across restarts (in-memory only).
- No credential columns beyond what the Phase 2 `User` model already provides
  (phone/email unique constraints, `User_contact_required` check).

## Related docs

- `docs/development/phase-3-9-notes.md` — the foundation phase.
- `docs/development/phase-3-18-notes.md` — the OD-005 resolution and full
  flow (backend + mobile).
- `docs/planning/open-decisions.md` — OD-005 (resolved) and the remaining
  OPEN decisions (OD-004/007/008/010).
