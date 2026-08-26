# Development Setup

How to get a working RidePool development environment.

## Prerequisites

| Tool       | Minimum | Recommended       | Purpose                    |
| ---------- | ------- | ----------------- | -------------------------- |
| Node.js    | 20      | 24 LTS            | Runtime for all workspaces |
| pnpm       | 9       | 10 (used in repo) | Package manager            |
| git        | any     | 2.5x              | Version control            |
| PostgreSQL | 16      | 18                | Database (see database.md) |

The repository pins its package manager via `packageManager` in `package.json`
(`pnpm@10.12.1`). Enable it with Corepack:

```powershell
corepack enable
```

## One-time setup

```powershell
git clone <repo-url> ride-pooling
cd ride-pooling

# Install all workspace dependencies (creates pnpm-lock.yaml)
pnpm install

# Local development database (creates .local/postgres and database "ridepool")
pnpm db:init
```

`pnpm db:init` is idempotent: it initializes the local PostgreSQL cluster on
the first run and starts it on subsequent runs.

### Apply the Phase 2 schema + seed data

```powershell
pnpm --filter @ridepool/backend db:migrate:deploy   # apply migrations (no prompts)
pnpm --filter @ridepool/backend db:generate         # generate Prisma Client
pnpm --filter @ridepool/backend db:seed             # load development seed data
```

See `docs/development/database.md` for the full domain model, migration, and
PostGIS details.

## Per-workspace environment files

Copy each `.env.example` to `.env`:

- `apps/backend/.env.example` → `apps/backend/.env`
- `apps/mobile` reads `EXPO_PUBLIC_API_URL` at build/bundle time (see
  `docs/development/environment.md`).

The backend `.env` is git-ignored; `.env.example` is committed as the contract.

## Verify the setup

```powershell
pnpm db:status        # local PostgreSQL cluster status
pnpm --filter @ridepool/backend db:check   # backend can connect + SELECT now()
pnpm typecheck        # all workspaces
pnpm lint             # all workspaces
pnpm test             # all workspaces
pnpm build            # all workspaces
```

## Running the stack

```powershell
pnpm dev              # backend (tsx watch) + mobile (Expo) concurrently
```

- Backend API: http://localhost:4000/health
- Mobile (Metro): http://localhost:8081

See `docs/development/development-workflow.md` for the daily loop and
`docs/development/testing.md` for the test commands.
