# Environment Configuration

How environment variables are loaded and validated across the repo.

## Backend (`apps/backend`)

The backend validates its environment at startup with **Zod** so a
misconfigured process fails fast with a clear message.

Source of truth: `apps/backend/src/config/env.ts` (Zod schema) and
`apps/backend/.env.example`.

| Variable                                | Required | Default                 | Description                                                        |
| --------------------------------------- | -------- | ----------------------- | ------------------------------------------------------------------ |
| `NODE_ENV`                              | no       | `development`           | `development` \| `test` \| `production`                            |
| `PORT`                                  | no       | `4000`                  | HTTP listen port                                                   |
| `DATABASE_URL`                          | yes      | —                       | PostgreSQL connection URL (must be URL)                            |
| `CORS_ORIGIN`                           | no       | —                       | Optional allowed browser origin                                    |
| `SOCKET_ENABLED`                        | no       | —                       | Reserved for Phase 3 Socket.io                                     |
| `MSG91_AUTH_KEY`                        | no       | —                       | MSG91 auth key (backend-only secret). OTP fails closed when absent |
| `MSG91_SENDER_ID`                       | no       | —                       | MSG91 6-char sender id (default `SMSIND`)                          |
| `MSG91_BASE_URL`                        | no       | `https://api.msg91.com` | MSG91 legacy API base URL                                          |
| `MSG91_OTP_EXPIRY_MINUTES`              | no       | `5`                     | OTP validity (1–1440)                                              |
| `MSG91_OTP_LENGTH`                      | no       | `6`                     | OTP digits (4–9)                                                   |
| `SESSION_TTL_DAYS`                      | no       | `30`                    | Auth session lifetime in days                                      |
| `MATCHING_PICKUP_RADIUS_METERS`         | no       | `5000`                  | Approved V1 pickup search radius in meters (OD-004, Phase 3.19)    |
| `MATCHING_DEPARTURE_WINDOW_MINUTES`     | no       | `60`                    | Approved V1 departure time window in ± minutes (OD-004)            |
| `MATCHING_DESTINATION_TOLERANCE_METERS` | no       | `5000`                  | Approved V1 destination tolerance in meters (OD-004)               |
| `MATCHING_MAX_RESULTS`                  | no       | `20`                    | Server-owned matching result cap (OD-004)                          |

Loading:

- `dotenv` (`import 'dotenv/config'`) loads `apps/backend/.env` on boot.
- `loadConfig()` in `src/config/index.ts` parses+validates and exposes
  convenience flags: `isProduction`, `isDevelopment`, `isTest`, `nodeEnv`.

> **Phase 2+ placeholders** (in `.env.example`, intentionally inactive):
> `MAP_PROVIDER`, `MAP_API_KEY`, `PUSH_PROVIDER`, `PUSH_API_KEY`. Do not wire
> these up before their features exist.
>
> **Authentication (Phase 3.18, OD-005 resolved):** sessions use opaque bearer
> tokens stored as SHA-256 hashes in the `AuthSession` table — no JWT secret is
> used (the former `JWT_SECRET`/`JWT_EXPIRES_IN` placeholders were removed).
> MSG91 variables are optional so dev/test boot without credentials; when
> `MSG91_AUTH_KEY` is unset the OTP provider fails closed. `MSG91_AUTH_KEY` is
> a backend-only secret and must never be set as an `EXPO_PUBLIC_*` variable.
>
> **Matching (Phase 3.19, OD-004 resolved):** `MATCHING_*` variables are
> server-controlled product policy — HTTP callers can never supply thresholds,
> weights, ranking, score, or result limits (such input is rejected at the API
> boundary). The defaults are the approved V1 values.

## Mobile (`apps/mobile`)

Expo inlines variables prefixed with `EXPO_PUBLIC_` at bundle time.

| Variable              | Default                 | Description      |
| --------------------- | ----------------------- | ---------------- |
| `EXPO_PUBLIC_API_URL` | `http://localhost:4000` | Backend base URL |

Use the helpers in `apps/mobile/src/lib/api.ts` (`resolveApiBaseUrl`,
`buildHealthUrl`) instead of hardcoding origins. `app.json` does not need
environment-specific values for the foundation.

> Note: on a physical device `localhost` refers to the device itself. For
> device testing set `EXPO_PUBLIC_API_URL` to your machine's LAN IP.

## Shared packages

`packages/config` exposes `parseNodeEnv` (see
`packages/config/src/node-env.ts`) used by the backend. `packages/shared`
holds API path/health/error contracts used by both backend and future mobile
code.

## Rules

- Only `.env.example` files are committed; real `.env` files are git-ignored
  (see `.gitignore`).
- Never commit secrets.
- If you add an environment variable, update the corresponding `.env.example`
  and this document.
