# Phase 3.24 — Reporting & Blocking: Implementation Notes

> Status: Phase 3.24 — Complete
> Date: 2026-08-25
> Resolves: nothing new. **OD-010 (identity verification) remains OPEN** and
> untouched, exactly as `docs/planning/phases/phase-3-24.md` §4/§24 require.

---

## 1. Objective

Give participants a way to report and block another user — the "basic safety"
baseline `docs/product/v1-scope.md` §1.13 and PRD §15 already commit to for V1
— without waiting on identity verification.

---

## 2. Discovery Summary

As in Phase 3.23, a discovery pass found that **the phase was already
implemented** in a prior session: the `Report`/`Block` models plus the
`20260821183252_phase_3_24_reporting_blocking` migration, the whole
`apps/backend/src/modules/safety/` tree (domain rules, four use cases, three
repositories, HTTP layer), the two Ride Engine block seams, the mobile
`src/safety/` module, three mobile screens, and navigation wiring were all
present and mounted (`app.ts:97`, `app-navigator.tsx`).

So this session's work was verification and gate-closing rather than
greenfield implementation: run every quality gate the phase spec §20 demands,
fix what failed, and bring the documentation in line with the code.

### What was verified as already correct

- **Schema + migration exist and are applied.** Unlike Phase 3.23's schema
  drift (a model with no migration), `Report`/`Block` have a real migration
  and `prisma migrate status` plus a live `db:check` both pass.
- **Identity is never client-supplied.** Both controllers take the actor from
  `getAuthenticatedUser(res)` and never read a body-supplied
  `reporterId`/`blockerId`; there are explicit tests for this.
- **Co-participant scoping (§9/§11/§13, DECIDED).** `areRideCoParticipants`
  enforces it for both reports and blocks, with 404-before-403 ordering per
  §14.
- **Soft-delete unblock (§9, DECIDED).** `softDeleteBlock` sets `unblockedAt`
  via `updateMany` (so a no-op pair is still a 204), and `createBlock`
  reactivates the same row instead of inserting a second one.
- **Rate limit (§11, DECIDED).** 5 per rolling 24h, as tunable constants in
  `domain/safety-rules.ts` with an injectable clock — not hardcoded at the
  call site.
- **Silence toward the target (§16, DECIDED).** No new `NotificationType`, no
  new realtime event (`REALTIME_EVENT_TYPES` is still the same seven), and
  integration tests assert no `Notification` row is created for the
  reported/blocked user.
- **Block effects are isolated (§21).** Discovery filtering is a single
  `NOT EXISTS` clause in `ride.repository.ts` driven by an optional
  `viewerId`, and new-request blocking is one `isBlockedPair` call in
  `create-ride-request.ts`. `block-effects.integration.test.ts` covers all
  three §13 behaviors, including that a block does **not** cancel an existing
  CONFIRMED participation.

---

## 3. What Was Actually Fixed This Phase

### A. The Ride Engine history-count failure was a wrong test, not a bug

`request-cancellation.integration.test.ts`'s last-participant revert case
asserted exactly one `RideStatusHistory` row for the ride and got two. Phase
3.23's notes recorded this as "a Ride Engine history-logging bug
(Phase 3.7/3.21 code)" and left it alone.

It is not a bug. The test's own fixture accepts a request before cancelling
it, so the ride legitimately records **two** transitions: `PUBLISHED →
CONFIRMED` on the first accept (Phase 3.6) and `CONFIRMED → PUBLISHED` on the
revert (Phase 3.21). Both are required by `docs/domain/ride-lifecycle.md`
(every transition emits a history row) and the sibling
`decision.integration.test.ts` asserts the first one explicitly. The
assertion was simply written as if the accept left no trace.

Fixed by asserting the count is 2 and then asserting the revert row
specifically (filtered by `fromStatus`/`toStatus`) rather than by index — so
the test still verifies actor and reason without being order-dependent. No
production code was changed.

### B. `format:check` was failing repo-wide

The root `format:check` gate failed on 28 files, most of them pre-existing
debt untouched by this phase (Phase 3.19/3.22/3.23 sources and docs). Two
issues were involved:

1. `pnpm-lock.yaml` was being checked and always reported dirty. Added it to
   `.prettierignore` alongside `package-lock.json`, which is where it should
   have been from the start — a generated lockfile is not source to format.
2. The remaining 27 files were genuinely unformatted (mostly long import
   statements that should have been wrapped). Fixed with
   `prettier --write .`.

Consequence: `format:check` is now green repo-wide for the first time, so the
gate is meaningful again rather than being routinely waived as "pre-existing
debt" the way Phase 3.23 §4 had to.

### C. Documentation was still describing the phase as unbuilt

`docs/planning/phases/phase-3-24.md` was headed "PROPOSED (NOT approved) —
planning specification only … no application code, Prisma schema, migrations,
tests, or dependencies have been changed", with all 19 acceptance criteria
unchecked — while the code was fully merged and passing. `roadmap.md`
likewise listed 3.24 as proposed and cited stale Phase 3.23 test counts with
two failures.

Updated: the spec's status header and §0 now read IMPLEMENTED (the design
sections are kept verbatim as the design record), §18's criteria are checked
with the implementing artifact named for each, and the roadmap lists 3.24 as
completed with current counts. The §22 INFERENCE list and §24 open items were
deliberately left as-is — implementing the phase does not resolve them, and
OD-010 in particular stays OPEN.

### D. A turbo/Windows note

`pnpm run typecheck` etc. from the repo root fail with
`I/O error: Incorrect function. (os error 1)` from turbo 2.10.9 in this
environment. Not a code problem — gates were run per-package
(`apps/backend`, `apps/mobile`, `packages/shared`) instead, which is what
turbo would have fanned out to anyway.

---

## 4. Verification Performed

All green:

- **Backend:** `typecheck`, `lint`, `test` (**1039/1039 passing**, 89 files),
  `build`.
- **Mobile:** `typecheck`, `lint`, `test` (**444/444 passing**, 57 files).
- **Shared:** `build`.
- **Repository:** `format:check` — clean repo-wide.
- **Database:** `prisma validate`, `prisma migrate status` (4 migrations, up
  to date), `db:check` against real local Postgres on `localhost:5433`.
- **Expo:** `expo config --type public` resolves.

No failures are being carried forward. Both items Phase 3.23 documented as
pre-existing are now closed: (A) above was the history-count one, and the
`location-search.test.tsx` flake did not reproduce in either full-suite run.

---

## 5. Known Limitations Carried Forward

- `app.json`'s `extra.eas.projectId` is still the
  `REPLACE_WITH_EAS_PROJECT_ID` placeholder (Phase 3.23 §5) — real push tokens
  need an actual EAS project linked, which is an Expo-account action outside
  this repository.
- Reports are recorded but never adjudicated: no admin/moderation module
  exists to consume them, and `Report` deliberately has no status/lifecycle
  field (§13). Phase 3.24 §23 flags the resulting user-expectation risk;
  in-app copy is the mitigation.
- Blocking does not remove either party from a ride they are already
  CONFIRMED on (§13, DECIDED). The normal cancellation flow is the way out.
  Also a copy/expectation risk per §23.
- Report/`Block` retention is indefinite pending **OD-013** (data retention),
  which is still OPEN.
- The co-participant check is a two-sided `Ride.findFirst`; §22 item 16 leaves
  its exact query shape open, and it is unindexed beyond the existing
  ride/participant indexes. Fine at V1 volumes, worth revisiting if report
  volume grows.
