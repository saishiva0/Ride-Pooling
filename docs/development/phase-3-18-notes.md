# Phase 3.18 — Phone + OTP Authentication (MSG91): Implementation Notes

> Status: Phase 3.18 — Implementation
> Delivers the full phone + OTP authentication flow across backend and mobile
> and **resolves OD-005 (authentication mechanism)** in favor of MSG91
> SendOTP with backend-owned verification and opaque bearer sessions.
> OD-004, OD-007, OD-008 and OD-010 remain OPEN and were NOT resolved; OD-010's
> auth-handshake sub-part is the only portion of that decision consumed here.

## 1. Product decisions honored

- **OD-005 — RESOLVED (see `docs/planning/open-decisions.md`).** The approved
  mechanism is phone + OTP via **MSG91 SendOTP (SMS only)**:
  - The backend owns OTP generation (`otp_expiry`, `otp_length`), delivery via
    the legacy SendOTP API (`sendotp.php`), and verification via
    `verifyRequestOTP.php` (the OTP is validated against MSG91 server-side;
    the mobile client never verifies anything locally).
  - Phones are canonical E.164: bare 10-digit numbers default to the `+91`
    country code (`parseE164Phone`), and `normalizePhone` from Phase 3.9
    remains the single normalization seam.
  - Sessions are opaque bearer tokens: 32 random bytes base64url generated
    server-side; the database stores only the SHA-256 hash (`AuthSession`).
    No JWTs, no refresh tokens. Default TTL 30 days (`SESSION_TTL_DAYS`).
  - `POST /auth/logout` revokes the session server-side; the mobile client
    best-effort revokes and always clears local storage.
  - Every outcome is generic: no enumeration, no provider-message leaks, no
    user-known registration status, and MSG91 transport failures are never
    exposed (backend `EXTERNAL_SERVICE_ERROR`; mobile generic copy).
  - New users are created on first successful sign-in with `name: ''`
    (there is no profile flow in this phase).
- **No other provider or mechanism was added**: no email/password, no magic
  links, no Firebase/Auth0/Clerk, no Apple/Google sign-in, no TOTP apps.
- **Backend-only secrets**: MSG91 `authkey` is configured server-side via env
  vars; there is no `EXPO_PUBLIC_*` MSG91 configuration on mobile.
- **Fail closed everywhere**: unauthenticated requests are rejected with 401
  and `AUTHENTICATION_ERROR`; the mobile app never renders authenticated
  content while the session is unresolved or rejected; storage read failures
  are treated as "no session".
- **Provider-neutral seams preserved**: the `Authenticator` /
  `HttpAuthenticator` / `AuthClient` / `AuthHeadersProvider` / `AuthProvider`
  ports from Phases 3.13–3.14 remain the only ways identity flows; tests still
  use `createTestAuthenticator()` and injected fakes.

## 2. What was NOT built (deliberate)

No refresh-token rotation, no multi-device session listing/management UI, no
passwordless email, no biometric/passkey unlock, no profile/name flow, no
account recovery beyond OTP resend, no MSG91 webhook handling, no OTP
verification retry counters persisted across restarts (in-memory only — see
§5), no device-token push registration, and no changes to the OTP length /
expiry policy beyond env defaults. No Phase 3.19+ features were implemented.

## 3. Backend files created

```
apps/backend/src/modules/auth/domain/phone.ts                  — parseE164Phone, toProviderPhone,
                                                                 DEFAULT_COUNTRY_CODE '91', E164_MAX_DIGITS 15,
                                                                 DEFAULT_NATIONAL_LENGTH 10
apps/backend/src/modules/auth/domain/session-token.ts          — generateSessionToken (32B base64url),
                                                                 hashSessionToken (sha256 hex),
                                                                 sessionExpiryFromNow, DEFAULT_SESSION_TTL_DAYS 30
apps/backend/src/modules/auth/application/otp-provider.ts      — OtpProvider port + request/verify/retry
                                                                 limits (3 per 10min, 5 per 10min)
apps/backend/src/modules/auth/application/rate-limiter.ts      — OtpRateLimiter + createInMemoryOtpRateLimiter
apps/backend/src/modules/auth/application/session-service.ts   — SessionService + SessionPersistence port
apps/backend/src/modules/auth/application/auth-dependencies.ts — AuthConfig, AuthUserPersistence, AuthDependencies,
                                                                 createDefaultAuthDependencies(config)
apps/backend/src/modules/auth/application/request-otp.ts       — requestOtp service (generic success)
apps/backend/src/modules/auth/application/verify-otp.ts        — verifyOtp service (creates user, issues session)
apps/backend/src/modules/auth/infrastructure/session.persistence.ts — Prisma tx persistence + upsertUserByPhone
apps/backend/src/modules/auth/infrastructure/msg91-provider.ts — createMsg91OtpProvider (sendotp /
                                                                 verifyRequestOTP / retryotp, sender SMSIND,
                                                                 10s timeout)
apps/backend/src/modules/auth/infrastructure/fake-otp-provider.ts — createFakeOtpProvider (tests only)
apps/backend/src/modules/auth/http/bearer-authenticator.ts    — getBearerToken, createBearerTokenAuthenticator
apps/backend/src/modules/auth/http/auth.schemas.ts            — requestOtpSchema, verifyOtpSchema
apps/backend/src/modules/auth/http/auth.controller.ts         — createAuthController (requestOtp, verifyOtp, me, logout)
apps/backend/src/modules/auth/http/auth.routes.ts             — createAuthRouter (POST /auth/request-otp,
                                                                 POST /auth/verify-otp, GET /auth/me,
                                                                 POST /auth/logout)
```

## 4. Backend files modified

- `apps/backend/prisma/schema.prisma` — new `AuthSession` model
  (`tokenHash @unique`, `expiresAt`, `revokedAt?`, `lastUsedAt?`, `createdAt`,
  FK → User, `@@index([userId])`, `@@index([expiresAt])`); `User` gains
  `sessions AuthSession[]`.
- `apps/backend/prisma/migrations/20260819114404_phase_3_18_auth_sessions/`
  — migration created and applied; `prisma validate` and `migrate status`
  clean.
- `apps/backend/src/config/env.ts` — optional `MSG91_AUTH_KEY`,
  `MSG91_SENDER_ID`, `MSG91_BASE_URL`, `MSG91_OTP_EXPIRY_MINUTES` (5),
  `MSG91_OTP_LENGTH` (6), `SESSION_TTL_DAYS` (30). Optional so dev/test boot
  without credentials; the provider fails closed when `MSG91_AUTH_KEY` is
  unset.
- `apps/backend/src/app.ts` — `AppOptions.authDeps?: Partial<AuthDependencies>`;
  the default authenticator is `createBearerTokenAuthenticator(...)` over the
  default session service; the auth router is mounted at `/auth`.
- `apps/backend/src/server.ts` — socket connections now authenticate with the
  real bearer authenticator over the default auth dependencies.
- `apps/backend/.env.example` — MSG91 + session vars documented; JWT
  placeholders removed.
- `docs/development/environment.md` — environment reference updated.

## 5. Design notes

- **Session tokens are unguessable and never logged**: 32 random bytes
  base64url; only the SHA-256 hash is persisted. A leaked DB dump cannot
  replay sessions.
- **`GET /auth/me`** returns the authenticated user (session
  identity derived from the bearer token — never caller-supplied) and is the
  mobile session-restore validation call.
- **Rate limiting is in-memory** (request: 3/10min, verify attempts: 5/10min
  per phone) and therefore single-instance only; a multi-instance deployment
  must replace it with a shared store (documented limitation, deliberately not
  built).
- **Error mapping**: bad/missing/revoked bearer → 401 `AUTHENTICATION_ERROR`;
  wrong/expired OTP → generic `AUTHENTICATION_ERROR` "Unable to authenticate";
  MSG91 transport failure → `EXTERNAL_SERVICE_ERROR` (never exposed verbatim);
  malformed phone/OTP → 400 `VALIDATION_ERROR`. No endpoint ever reveals
  whether a phone is registered.
- **MSG91 contract** (legacy SendOTP): `GET /api/sendotp.php?authkey=&mobile=<intl>&message=&sender=&otp_expiry=&otp_length=`;
  `GET /api/verifyRequestOTP.php?authkey=&mobile=&otp=`; `GET /api/retryotp.php?authkey=&mobile=&retrytype=text`.
  Message template carries `##OTP##` / `##OTP_EXPIRY##`. Sender default
  `SMSIND`; `MSG91_BASE_URL` default `https://api.msg91.com`.

## 6. Mobile files created

```
apps/mobile/src/auth/create-default-auth-dependencies.ts        — production composition root (secure
                                                                   storage + stored headers provider +
                                                                   generic client + auth API + AuthClient)
apps/mobile/src/auth/auth-api.ts                                — createAuthApi (request-otp / verify-otp /
                                                                   me / logout wire contract)
apps/mobile/src/auth/storage/types.ts                           — StoredSession + SessionStorage seam
apps/mobile/src/auth/storage/session-validation.ts              — parseStoredSession (fail-closed parse)
apps/mobile/src/auth/storage/memory.ts                          — createMemorySessionStorage (tests/fallback)
apps/mobile/src/auth/storage/secure.ts                          — createSecureSessionStorage (expo-secure-store,
                                                                   key 'ridepool.session.v1')
apps/mobile/src/screens/auth/phone-entry-screen.tsx             — step 1: enter phone → requestOtp
apps/mobile/src/screens/auth/otp-verification-screen.tsx        — step 2: enter code → signIn; resend OTP
apps/mobile/src/navigation/auth-navigator.tsx                   — public boundary sequencing phone → OTP
tests/mocks/expo-secure-store.ts                                — fail-closed vitest mock (test infra only)
```

Mobile files rewritten/extended:

- `src/auth/auth-client.ts` — `AuthClient` now exposes `requestOtp(phone)` and
  `signIn(phone, otp)`; `createAuthClient` restores+re-validates the session,
  requests OTPs, signs in (persists only the token/expiry/userId in secure
  storage), and best-effort signs out. `unavailableAuthClient` remains the
  fail-closed default and now also throws on `requestOtp`.
- `src/auth/auth-headers.ts` — adds the optional `onAuthenticationFailure`
  hook and `createStoredAuthHeadersProvider` (Bearer token over storage;
  clears on 401).
- `src/auth/auth-provider.tsx` — without an injected client it lazily builds
  the concrete client via `createDefaultAuthDependencies()`; owns the wrapped
  headers provider (its failure hook also settles the app to
  `unauthenticated`); context exposes `headersProvider`, `requestOtp(phone)`,
  and `signIn(phone, otp)`.
- `src/api/client.ts` — on an authentication error / 401 it invokes
  `config.authProvider?.onAuthenticationFailure?.()`.
- `src/navigation/routes.ts` — `AUTH_PLACEHOLDER` replaced with `AUTH_PHONE`
  and `AUTH_OTP`.
- `src/navigation/root-navigator.tsx` — `unauthenticated` and
  `authentication-error` render the real `AuthNavigator` (replacing
  `AuthBoundaryScreen`, which was deleted).
- `src/navigation/app-navigator.tsx` — `createDefaultRideApi` now takes the
  auth headers provider from the auth context (real bearer session); tests
  still inject a mock `RideApi`.
- `src/screens/auth-boundary-screen.tsx` — deleted (superseded by the real
  flow).
- `App.tsx` — doc comment updated; the shell is unchanged (default
  `AuthProvider` now wires the real client).

## 7. Mobile design notes

- **No credentials in the bundle.** The bearer token exists only inside
  `expo-secure-store` (platform Keychain/Keystore via the `expo-secure-store`
  config plugin) and in the `Authorization` header of outgoing requests.
- **Session restore re-validates with the backend** (`GET /auth/me`): a stale,
  expired, or revoked stored session fails closed to `null`; storage read
  failures are "no session"; network/server failures propagate so the provider
  settles into `authentication-error`.
- **Generic copy everywhere**: `mobileErrorMessage` maps every auth failure to
  "Authentication failed. Sign in again."; no MSG91 detail, no registration
  status, no token text is ever rendered.
- **Resend OTP** calls `requestOtp` for the same phone (server-side rate
  limited); the resend result is its own small `AsyncState` line.
- **Tests inject fakes**; the default path is covered deterministically because
  `expo-secure-store` resolves to the fail-closed mock in vitest (session
  restore → null → `unauthenticated`).

## 8. Test matrix

Backend additions (838 tests / 69 files total, all green; was 768 / 60):

- `domain/phone.test.ts`, `domain/session-token.test.ts` — E.164 parsing,
  provider phone, token generation/ hashing/expiry.
- `application/rate-limiter.test.ts`, `request-otp.test.ts`,
  `verify-otp.test.ts`, `session-service.test.ts` — limits, generic outcomes,
  user creation, session issue/revoke/restore.
- `infrastructure/msg91-provider.test.ts` — MSG91 URL construction, timeouts,
  fail-closed without authkey, response parsing.
- `http/bearer-authenticator.test.ts` — token extraction, 401 mapping, bearer
  seam.
- `http/auth.http.integration.test.ts` (13) — real DB + fake provider
  (`ACCEPTED_OTP` `'123456'`): request-otp → verify-otp → me → logout happy
  path, wrong OTP, rate limits, duplicate phone sign-in (single user), revoked
  session 401, cleanup via `trackUserAndSessions`.

Mobile (275 tests / 38 files total, all green; was 225 / 32):

- `auth-client.test.ts` (19) — unavailable default contract + concrete client
  (persist on sign-in, restore+re-validate, expiry/foreign-session/storage-
  failure fail-closed, sign-out revoke+clear).
- `auth-headers.test.ts` (10) — fail-closed default + stored provider (bearer
  attach, expired/corrupt/read-failure fail-closed, 401 clear).
- `storage/session-validation.test.ts` (7) + `storage/memory.test.ts` (5) —
  fail-closed parse rules and deterministic storage behavior.
- `auth-api.test.ts` (4) — exact wire contract for the four endpoints.
- `screens/auth/phone-entry-screen.test.tsx` (5) + `otp-verification-screen.test.tsx` (6)
  — validation, success/advance, generic error copy, resend, goBack.
- `navigation/auth-navigator.test.tsx` (4) — sequencing phone → OTP, goBack,
  error stays on phone entry.
- Updated: `auth-provider.test.tsx` (signIn now takes phone+otp; context
  surface), `root-navigator.test.tsx` + `App.test.tsx` (real auth boundary),
  `errors.test.ts` (generic copy, no OD-005 reference), `fixtures.ts`
  (pre-existing type-correctness fixes: `creatorRide()` fixture, `Date`
  timestamps), `vitest.config.ts` + `tests/mocks/expo-secure-store.ts` alias.

## 9. Runbook (exact commands, all green)

```
pnpm --filter @ridepool/backend typecheck   # tsc --noEmit (strict) — clean
pnpm --filter @ridepool/backend lint        # eslint . — clean
pnpm --filter @ridepool/backend test        # vitest run — 838 passed / 69 files
pnpm --filter @ridepool/backend exec prisma validate        # schema valid
pnpm --filter @ridepool/backend exec prisma migrate status  # up to date
pnpm --filter @ridepool/backend db:check    # DB connectivity OK
pnpm --filter @ridepool/mobile typecheck    # tsc --noEmit (strict) — clean
pnpm --filter @ridepool/mobile lint         # eslint . — clean
pnpm --filter @ridepool/mobile test         # vitest run — 275 passed / 38 files
pnpm format:check                           # Prettier-clean
pnpm --filter @ridepool/mobile exec expo config --type public  # resolves cleanly
```

## 10. Environment variables (backend)

| Variable                   | Default                 | Purpose                                             |
| -------------------------- | ----------------------- | --------------------------------------------------- |
| `MSG91_AUTH_KEY`           | (unset)                 | MSG91 API authkey; provider fails closed when unset |
| `MSG91_SENDER_ID`          | `SMSIND`                | Sender ID for the SMS                               |
| `MSG91_BASE_URL`           | `https://api.msg91.com` | MSG91 API base                                      |
| `MSG91_OTP_EXPIRY_MINUTES` | `5`                     | OTP validity window                                 |
| `MSG91_OTP_LENGTH`         | `6`                     | OTP digit count (4–9 allowed)                       |
| `SESSION_TTL_DAYS`         | `30`                    | Session lifetime in days                            |

No `EXPO_PUBLIC_*` authentication variables were added to mobile.

## 11. Open decisions (unchanged)

- OD-004 matching thresholds/weights — still not defaulted.
- OD-007 maps/GPS — still OPEN; no map/GPS provider added.
- OD-008 realtime — still fail-closed `unavailableRealtimeClient`.
- OD-010 verification — OPEN; only the auth-handshake sub-part was consumed by
  this phase's authenticated sockets.

## 12. Known limitations

- OTP rate limiting is in-memory (single-instance). A multi-instance deployment
  needs a shared store.
- No profile/name flow yet (`name: ''` for new users), no multi-device session
  management UI, no refresh-token rotation.
- In-memory `AuthSession.lastUsedAt` is not updated on every request (no policy
  invented); sessions expire by TTL or explicit revoke.
- `react-test-renderer` deprecation warning persists (unchanged from earlier
  phases; see Phase 3.13 notes §13).

## 13. What a later phase must decide (future work)

- Profile/display-name flow (the `name: ''` placeholder), account settings and
  multi-device session management.
- A multi-instance-safe rate limiter and any hardened OTP policies (attempt
  cooldowns, resend throttling beyond the 10-minute window).
- OD-010 verification scope beyond the auth handshake.

## 14. Final verification report

Run against the working tree on 2026-08-19 after all Phase 3.18 changes,
including the stale OD-005 comment sweep and `pnpm format`:

| Gate                                                            | Result                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| `pnpm --filter @ridepool/backend typecheck`                     | clean (`tsc --noEmit`, strict)                               |
| `pnpm --filter @ridepool/backend lint`                          | clean (`eslint .`)                                           |
| `pnpm --filter @ridepool/backend test`                          | 838 passed / 69 files                                        |
| `pnpm --filter @ridepool/backend exec prisma validate`          | clean                                                        |
| `pnpm --filter @ridepool/backend exec prisma migrate status`    | up to date                                                   |
| `pnpm --filter @ridepool/backend db:check`                      | OK                                                           |
| `pnpm --filter @ridepool/mobile typecheck`                      | clean (`tsc --noEmit`, strict)                               |
| `pnpm --filter @ridepool/mobile lint`                           | clean (`eslint .`)                                           |
| `pnpm --filter @ridepool/mobile test`                           | 275 passed / 38 files                                        |
| `pnpm format:check`                                             | Prettier-clean (after `pnpm format`)                         |
| `pnpm --filter @ridepool/mobile exec expo config --type public` | resolves cleanly, sdk 57, `expo-secure-store` plugin present |

All gates green; no open issues remain in this phase. Stale OD-005 "OPEN"
references were swept from live source, module docs, and phase-3-17.md;
historical phase notes (`phase-3-9-notes.md` … `phase-3-16-notes.md`) were
left untouched as the audit record, and `apps/backend/dist/**` build artifacts
were left as-is.
