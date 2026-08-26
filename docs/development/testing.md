# Testing

What is tested in Phase 1 and how to run it.

## Test runner

- Backend and shared packages: **Vitest** (`vitest run`).
- Config: Vitest (backend's `src/config/index.test.ts`).
- Mobile: Vitest (node environment) for pure logic; Expo/React Native UI is
  manually verified via Metro in the foundation.

## Running tests

From the repo root:

```powershell
pnpm test                 # every workspace that has a test script
pnpm --filter @ridepool/backend test
pnpm --filter @ridepool/mobile test
pnpm --filter @ridepool/backend test:watch   # backend watch mode
```

## What the tests cover

| Suite            | File(s)                                 | Covers                                                                                                                                    |
| ---------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Backend config   | `apps/backend/src/config/index.test.ts` | env defaults, missing `DATABASE_URL` throws, invalid URL throws                                                                           |
| Backend HTTP     | `apps/backend/src/app.test.ts`          | `GET /health` returns 200; unknown route handled by error middleware                                                                      |
| Backend database | `apps/backend/src/lib/database.test.ts` | Phase 2 persistence: model creation/relationships, unique constraints, FK integrity, CHECK constraints, PostGIS spatial storage/functions |
| Mobile API lib   | `apps/mobile/src/lib/api.test.ts`       | base URL default, trailing-slash stripping, health URL builder                                                                            |

`database.test.ts` runs against the real dev PostgreSQL/PostGIS database (not
a mock) — it requires the Phase 2 migration to be applied
(`pnpm --filter @ridepool/backend db:migrate:deploy`) and a reachable
`DATABASE_URL`. Every fixture it creates is tracked and deleted in
`afterAll`, so it does not pollute seed data. It validates persistence
behavior only — no Ride Engine business logic (lifecycle transitions,
matching, pricing calculation) is tested here; that belongs to a future
phase.

Test files use `*.test.ts` and are excluded from ESLint (see
`eslint.config.mjs`) so test syntax stays unconstrained.

## Writing tests (conventions)

- Put tests next to the code: `src/<feature>/<name>.test.ts`.
- Backend tests import the Express app via `createApp` (no network listen),
  using `supertest` for HTTP-level assertions.
- Mobile pure-logic tests run in the Vitest `node` environment and must not
  import React Native components (those are verified via Metro).
- Assertions cover behavior, not implementation details.

## Non-functional verification (Phase 1 quality gate)

Beyond automated tests, the Phase 1 gate verifies by running the real system:

1. `GET http://localhost:4000/health` returns
   `{"status":"ok","service":"ridepool-api",…}`.
2. `pnpm --filter @ridepool/backend db:check` confirms the backend can reach
   PostgreSQL (`SELECT now()`).
3. Expo/Metro starts (`packager-status:running` on port 8081).
4. Typecheck, lint, format, build all pass from the root.

See `docs/development/development-workflow.md` for the full gate order.
