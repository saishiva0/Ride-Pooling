# Development Workflow

The daily loop for working in the RidePool monorepo.

## Repository layout

```
apps/backend     # RidePool API (modular monolith, Node.js + TypeScript)
apps/mobile      # RidePool mobile app (React Native + Expo)
packages/shared  # Shared types/constants/contracts
packages/config  # Shared configuration utilities
scripts/         # Repository helper scripts (e.g. dev-db.ps1)
docs/            # Product/domain/architecture + development docs
```

## Build orchestration

Turborepo wires the workspace scripts together (`turbo.json`):

- `pnpm build` builds in dependency order (`shared`, `config`, then `backend`).
- `pnpm test`, `pnpm lint`, `pnpm typecheck` fan out to every workspace that
  defines the corresponding script.
- Cache lives under `.turbo/` (git-ignored).

Each package is self-contained: it declares its own `build`, `lint`,
`typecheck`, and (where relevant) `test` scripts.

## Adding a new backend module

Phase 2+ will add business modules under `apps/backend/src/modules/<name>/`.
The foundation already defines the conventions:

- A module owns its routes (`*.router.ts`), services, and models.
- Routers mount under `/api/v1` in `src/app.ts` (see the placeholder comment).
- Shared error types live in `src/lib/errors.ts`; shared contracts come from
  `packages/shared`.
- Requests get a `x-request-id` from `requestContext` middleware; the
  `errorHandler` returns consistent JSON error responses.

Do not add business logic in Phase 1. See `apps/backend/src/modules/README.md`.

## Mobile (Expo)

- Entry point: `apps/mobile/App.tsx`.
- `EXPO_PUBLIC_API_URL` is read at bundle time (dot notation for Expo inlining).
- Do not hardcode the backend origin; use the shared API helpers in
  `apps/mobile/src/lib/api.ts`.

## Environment & secrets

- `.env` files are git-ignored. Only `.env.example` is committed.
- Never commit real secrets. See `docs/development/environment.md`.

## Formatting

Prettier is the single formatter, configured at the repo root
(`.prettierrc.json`, `.editorconfig`). Run from the root:

```powershell
pnpm format          # write fixes
pnpm format:check    # verify only
```

`lint-staged` (via husky `prepare`) formats staged files on commit. Husky is
configured to skip gracefully when `.git` is absent (e.g. CI or a fresh copy).

## Quality gate before merging

Every change must pass:

1. `pnpm format:check`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm build`

CI runs the same checks (`.github/workflows/ci.yml`).

## Commit convention

Use short, descriptive messages that describe the change (no ticket prefix
required). Stage only intended files; never commit secrets, `.local/`, `dist/`,
or lockfile churn unrelated to your change.
