# Database (PostgreSQL + PostGIS)

RidePool uses **PostgreSQL with PostGIS** for relational data and geospatial
queries (ADR-010 direction). This document explains how to get a working
database for development.

## TL;DR

```powershell
pnpm db:init      # initialize + start the LOCAL dev cluster, create db "ridepool"
pnpm db:start     # start the local dev cluster
pnpm db:stop      # stop the local dev cluster
pnpm db:status    # check status
pnpm --filter @ridepool/backend db:check   # backend connectivity check (SELECT now())
```

## Local development cluster

The dev database is a **project-local PostgreSQL 18 cluster** (not the
system-wide service), so it needs no admin rights and no password surprises.

- Data directory: `.local/postgres/data` (git-ignored via `.local/`)
- Port: **5433** (avoids clashing with any system PostgreSQL on 5432)
- User: `ridepool` / password: `ridepool_dev` (development only)
- Database: `ridepool`
- Managed by `scripts/dev-db.ps1` and the `pnpm db:*` scripts above.

`DATABASE_URL` (see `apps/backend/.env.example`):

```
postgresql://ridepool:ridepool_dev@localhost:5433/ridepool?schema=public
```

## Why not the system PostgreSQL service?

The machine also has a system PostgreSQL 18 service on port 5432 whose
superuser password is not available in this environment. Rather than guess or
reset it, the project uses its own cluster. This keeps development
reproducible and isolated; production uses a real managed PostgreSQL with a
proper password.

## Windows note: starting the cluster

User-spawned PostgreSQL on Windows can fail with shared-memory/DLL errors
(`could not reserve shared memory region … error code 487`,
`0xC0000142`) when started from a shell with a polluted `PATH`. The helper
script starts the server with a minimal `PATH` (`C:\Windows\System32;C:\Windows;<pgbin>`)
to avoid this. Use `pnpm db:start` rather than starting `postgres.exe` by hand.

## Prisma

- Schema: `apps/backend/prisma/schema.prisma`
- **Phase 2** adds the full domain model: `User`, `Location`, `Ride`,
  `RideRequest`, `RideParticipant`, `RideStatusHistory`, `Notification` — see
  `docs/domain/domain-model.md`. No Ride Engine business logic lives here;
  this is the persistence layer only.
- Migration: `apps/backend/prisma/migrations/20260813185022_phase2_domain_model`
  (tracked by Prisma Migrate).
- Generate the client: `pnpm --filter @ridepool/backend db:generate`
- Apply pending migrations (dev): `pnpm --filter @ridepool/backend db:migrate`
- Apply pending migrations (CI/prod-like, no prompts): `pnpm --filter @ridepool/backend db:migrate:deploy`
- Seed development data: `pnpm --filter @ridepool/backend db:seed`
- Inspect with Prisma Studio: `pnpm --filter @ridepool/backend db:studio`

### Features Prisma cannot express natively

A few structural pieces are added via custom SQL in the migration file
(`migration.sql`), because Prisma's schema language does not support them on
PostgreSQL:

- **Generated PostGIS column:** `Location.point` is a
  `geometry(Point, 4326) GENERATED ALWAYS AS (...) STORED` column, derived
  automatically from `latitude`/`longitude`. Declared in `schema.prisma` as
  `Unsupported("geometry")` with a matching `@default(dbgenerated(...))` and
  `@@index(..., type: Gist)` so `prisma migrate dev` sees no drift, but the
  actual DDL is hand-written SQL.
- **CHECK constraints:** contact-required (User), lat/lng range (Location),
  positive seats/price, non-negative distance/contribution, and
  pickup ≠ destination (Ride). Prisma does not model CHECK constraints at
  all (see `prisma db pull` warnings), so these are invisible to Prisma's
  diffing and require no special handling — they simply persist across
  migrations.
- **Partial (filtered) unique indexes:** duplicate-active-request prevention
  on `RideRequest (rideId, userId) WHERE status IN ('PENDING','ACCEPTED')`,
  and duplicate-confirmed-participation prevention on
  `RideParticipant (rideId, userId) WHERE status = 'CONFIRMED'`.

None of this is business logic (no triggers, no stored procedures) — only
structural/data-integrity constraints, per `docs/domain/ride-engine.md` §5
invariants.

## PostGIS

PostGIS **3.6.2** is installed and enabled in the `ridepool` database (this
was a blocker in Phase 1; resolved before Phase 2 domain modeling began).
The exact installed version must match the `extensions = [postgis(version:
"3.6.2")]` declaration in the Prisma datasource — Postgres requires an exact
version match for `CREATE EXTENSION ... WITH VERSION`.

Verify locally:

```sql
SELECT postgis_version();
SELECT extversion FROM pg_extension WHERE extname = 'postgis';
```

> Do **not** replace PostGIS with a non-geospatial store. If PostGIS ever
> becomes unavailable in a future environment, raise it as an open decision
> rather than changing the datastore silently.

## Production

Production uses a managed PostgreSQL instance; credentials are injected via
environment (never committed). Apply migrations with
`prisma migrate deploy` (no interactive prompts, no shadow database).
