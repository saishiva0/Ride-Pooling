# Phase 3.24 — Reporting & Blocking

> Status: **IMPLEMENTED** — spec below retained as the design record
> Predecessor: Phase 3.23 (complete). Depends on Phase 3.18 (auth), Phase 3.21
> (request/participant lifecycle), Phase 3.22 (realtime), Phase 3.23
> (notifications). Does **NOT** depend on, and does **NOT** resolve, OD-010.

---

## 0. Status

**IMPLEMENTED.** This document began as a planning specification; the design
it describes has since been built and verified (§18 acceptance criteria all
checked; see `docs/development/phase-3-24-notes.md`). The sections below are
kept verbatim as the design record — where they say "proposed", read that as
the proposal that was subsequently implemented.

This phase's scope was explicitly narrowed by the product owner (2026-08-21)
from the original "Verification & Safety" concept to **reporting and
blocking only**. Identity verification is deferred — see §4.

Several design choices originally flagged as INFERENCE in this document's
first version have since been reviewed and decided by the product owner,
also on 2026-08-21: ride-co-participant scoping for reporting/blocking, the
effect of blocking on an existing CONFIRMED participation, the silence of
notifications toward the reported/blocked target, unblock retention (soft
delete), the report rate-limit threshold, and the risk-register R6
phase-label conflict. Those items are marked **DECIDED** (cited inline as
"Product owner decision, 2026-08-21") at each relevant section below (§5,
§9, §10, §11, §13, §16, §18, §22, §24). OD-010 (identity verification)
remains untouched and **OPEN**.

---

## 1. Objective

Give participants a way to report another user and to block another user,
as the "basic safety" baseline the product docs already commit to for V1 —
independent of, and without waiting on, the still-open identity-verification
decision (OD-010).

**CANONICAL** — this objective is directly stated:

- `docs/product/v1-scope.md` item 13: "Basic safety: reporting, blocking,
  profile info, cancellation controls."
- `docs/product/product-requirements.md` §15: "Reporting and blocking (V1
  baseline)."
- `docs/architecture/module-boundaries.md` §4.7 (Safety & Trust, module tier
  SUPPORTING, "✅ baseline" for V1): "Reporting, blocking, cancellation
  controls, user safety information, basic verification, abuse prevention."

---

## 2. Canonical sources

| Doc                                                                        | Relevant content                                                                                                                                                                                      |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/product/v1-scope.md` §1 item 13                                      | Reporting + blocking listed as V1 in-scope, alongside profile info and cancellation controls                                                                                                          |
| `docs/product/product-requirements.md` §15                                 | "Reporting and blocking (V1 baseline)"; "User safety info on profile"; "Abuse prevention (rate limiting, duplicate prevention)"; "Basic verification (degree of verification = open decision OD-010)" |
| `docs/architecture/module-boundaries.md` §4.7                              | Safety & Trust module responsibilities and V1-baseline classification                                                                                                                                 |
| `docs/planning/risk-register.md` R6                                        | Risk "Inappropriate/untrusted participants," mitigation "Profile info, basic verification (OD-010), reporting/blocking baseline"                                                                      |
| `docs/planning/open-decisions.md` OD-010                                   | Verification requirements — OPEN, blocking V1/V1.1, "must not be resolved by any implementation phase without an explicit decision"                                                                   |
| `docs/planning/roadmap.md` (this phase's entry, added alongside this spec) | Phase 3.24 scoped to reporting & blocking; verification deferred                                                                                                                                      |

**Not found** (confirmed by direct search, zero mentions):

- `docs/architecture/api-boundaries.md` — no report/block endpoints defined
- `docs/architecture/event-model.md` — no report/block events defined
- `apps/backend/prisma/schema.prisma` — no `Report`/`Block` model; `User` has
  only `id`, `name`, `phone`, `email`, `createdAt`, `updatedAt` plus relations

This phase therefore **defines the contract** for a canonically-scoped but
previously unspecified feature. Every concrete design choice below that is
not directly stated in the sources above is labeled **SUPPORTED** or
**INFERENCE**, per the legend in §3a.

### 3a. Labeling legend

- **CANONICAL** — directly stated in a canonical doc (file cited inline).
- **SUPPORTED** — reasonably implied by canonical docs plus existing,
  already-implemented architecture conventions (e.g. auth middleware
  pattern, response envelope, module layering); the inference is explained
  inline.
- **INFERENCE** — a design choice being proposed now with no canonical
  backing, needed to make the feature concrete. Flagged as a **proposal**,
  not a decided requirement. Every INFERENCE item also appears in §22
  (Assumptions) and, where a human should explicitly rule on it before
  implementation, in §24 (Explicitly unresolved items).

---

## 4. OD-010 relationship

**This phase does NOT resolve OD-010.** OD-010 concerns _identity
verification_ — the method, mandatoriness, provider, and lifecycle of
verifying who a user is (**CANONICAL**, `docs/planning/open-decisions.md`
OD-010 row: "Verification requirements (how much identity verification is
required)," impact "Safety module, auth," blocking "V1/V1.1"). Reporting and
blocking are a distinct capability — flagging/restricting interaction with a
_already-registered_ user — and do not require, and are not gated by,
resolving how strongly that user's identity was verified at signup.

`docs/planning/roadmap.md` states: "Open decision OD-010 must not be resolved
by any implementation phase without an explicit decision" (**CANONICAL**).
This phase complies: it neither selects nor implies a verification method,
provider, mandatoriness policy, or document/KYC/age-verification mechanism.
Identity verification remains **OPEN** and is **explicitly deferred** to a
future phase that can only be scoped after OD-010 is decided (see §6, §24).

---

## 5. In-scope functionality

1. **Reporting** — an authenticated user can submit a report against
   another user **who is or was a ride co-participant with them** (i.e. the
   reporter and the target each hold creator-or-participant status on at
   least one shared ride, §9/§13), with a reason/category and optional
   free-text detail, optionally associated with a specific ride. The
   reporting capability itself is **CANONICAL** (PRD §15, v1-scope item 13);
   the ride-co-participant scoping restriction is **DECIDED** (Product owner
   decision, 2026-08-21) — reporting is **not** open to arbitrary
   user-by-ID reporting.
2. **Blocking** — an authenticated user can block another user **who is or
   was a ride co-participant with them**, on the same co-participant scoping
   basis as reporting. The blocking capability itself is **CANONICAL** (PRD
   §15, v1-scope item 13); the co-participant scoping restriction is
   **DECIDED** (Product owner decision, 2026-08-21) — not open to arbitrary
   user-by-ID blocking.
3. **Unblocking** — a user can reverse a block they created. The existence of
   this capability was originally **INFERENCE**; it is now implicitly
   confirmed by the product owner's 2026-08-21 decision on unblock retention
   (§9, §13), which specifies how an unblock is recorded (soft delete) and
   therefore presupposes the action exists. The retention mechanism is
   **DECIDED**; the UX/entry-point detail remains an implementation matter.
4. **Report/block listing** — a user can view reports they filed and users
   they have blocked. **INFERENCE** — necessary for the feature to be usable
   (a user needs to see/manage what they've done) but no canonical doc
   specifies a listing UI or endpoint.
5. **Minimal safety-relevant effect on matching/interaction** — a block
   affects whether the blocked user's rides/requests are visible to /
   actionable by the blocking user going forward. **SUPPORTED** — PRD §15
   groups "user safety info on profile" and "abuse prevention" with
   reporting/blocking, and `module-boundaries.md` §4.7 groups blocking with
   "cancellation controls" and "abuse prevention" under the same module,
   implying blocking is meant to have a real interaction-limiting effect, not
   just be a passive record. The general principle — blocking affects future
   discovery/matching/new-requests but does **not** retroactively cancel an
   existing CONFIRMED participation — is now **DECIDED** (Product owner
   decision, 2026-08-21; see §13). Only the fine-grained filtering mechanics
   remain an implementation detail (still noted as INFERENCE in §13/§22).
6. **Existing profile fields already suffice as "user safety information."**
   No new profile fields are proposed. **SUPPORTED** — the `User` model
   already carries `name`; PRD §15's "user safety info on profile" is treated
   as already met by existing profile display (name), and this phase adds no
   new profile schema. This interpretation is called out in §22 as an
   assumption a human can override (e.g. if "safety info" was meant to
   include something like a join date or ride-completion count not yet
   modeled).

---

## 6. Explicit out-of-scope functionality

**CANONICAL / explicit exclusion per this phase's brief:**

- Any identity-verification mechanism (document upload, selfie/liveness
  check, government ID check, third-party KYC provider, phone-only vs.
  stronger verification tiers)
- Age verification
- Document verification
- Any resolution, partial resolution, or narrowing of OD-010 itself
- Any change to `AuthSession`, OTP, or the Phase 3.18 authentication flow

**Also out of scope (consistent with prior-phase conventions, e.g. Phase
3.22 §2 / Phase 3.23 §2):**

- Chat/messaging (Phase 3.25 territory, OD-009)
- Payments
- Admin moderation tooling / an admin review queue or dashboard for reports
  (`module-boundaries.md` §4.8 "Admin" is explicitly FUTURE) — **CANONICAL**
- Automated account suspension, penalty scoring, or trust scoring from
  reports — **INFERENCE-avoidance**: no canonical doc specifies punitive
  automation, so none is proposed; a report is recorded, not auto-adjudicated
- Analytics/observability on report/block volume beyond what already exists
- Any new realtime event beyond what §15 proposes (kept minimal)

---

## 7. Backend scope

**SUPPORTED** — new module following the existing `apps/backend/src/modules/{api,auth,health,location,notification,realtime,ride}` layering convention (per-module `domain/`, `application/`, `infrastructure/`, `http/` split as seen in `ride` and `notification`):

```
apps/backend/src/modules/safety/
  domain/report-rules.ts            — allowed reasons, self-report/self-block rejection, idempotency rules
  application/create-report.ts      — create a report (validates target exists, actor != target)
  application/list-my-reports.ts    — list reports filed by the caller
  application/create-block.ts       — create a block (idempotent: blocking twice is a no-op)
  application/remove-block.ts       — unblock
  application/list-my-blocks.ts     — list users the caller has blocked
  infrastructure/report.repository.ts
  infrastructure/block.repository.ts
  http/safety.controller.ts
  http/safety.routes.ts
  http/safety.schemas.ts
```

This structure mirrors `modules/ride` and `modules/notification` (domain
rules separate from application use cases separate from persistence separate
from HTTP). **INFERENCE** on exact file names; the layering pattern itself is
SUPPORTED by direct precedent.

Cross-module read: blocking must be consultable by the `ride` module's
discovery/matching and request-acceptance paths (see §13). **INFERENCE** —
proposed as a narrow read-only dependency (`ride` queries "is X blocked by
Y" via a safety-module query function), consistent with
`module-boundaries.md` §5's rule that "modules depend on Ride Engine events
... never the reverse" for _side effects_, but this is a same-direction
concern (Safety & Trust is SUPPORTING and may need to inform Ride Engine
queries) not explicitly addressed in that doc. Flagged in §24 for
architecture review — an alternative is to keep it Safety-module-owned and
have Ride Engine call outward, or to filter at the API composition layer
instead of inside Ride Engine's application services.

---

## 8. Mobile scope

**SUPPORTED** — new module following the `apps/mobile/src/{api,auth,components,config,hooks,location,navigation,notifications,realtime,ride,screens,state,theme}` convention:

```
apps/mobile/src/safety/
  api/safety-client.ts       — report/block/unblock/list HTTP calls
  hooks/useReport.ts
  hooks/useBlock.ts
  screens/ReportUserScreen.tsx     — INFERENCE: exact screen name/flow
  screens/BlockedUsersScreen.tsx   — INFERENCE
components/ (or safety/components/) ReportButton, BlockButton — surfaced from
  a user's profile view and/or a ride participant list
```

**INFERENCE** — no UX flow is specified anywhere; screen names, entry points
(e.g. "report" surfaced from ride detail participant list vs. from a
standalone profile screen), and confirmation-dialog copy are all proposed
placeholders for a human/product decision, not requirements.

---

## 9. Database scope (PROPOSAL ONLY — schema.prisma NOT edited)

Presented for human review, modeled after the existing `DevicePushToken` /
`AuthSession` conventions (userId FKs, `cuid()` ids, `createdAt`/`updatedAt`,
indexes matching the query patterns comment style already used in
`schema.prisma`). Three specific points below are now **DECIDED** (Product
owner decision, 2026-08-21): the ride-co-participant eligibility check,
soft-delete on unblock, and the rate limit being a config constant rather
than a schema/table concern. The remaining schema shape (`ReportReason`
enum values, exact field/index list beyond what's called out below) stays
**INFERENCE**, a proposal for human review.

```prisma
// PROPOSAL — not applied. A user-filed report against another user,
// optionally scoped to a specific ride. Reports are never auto-adjudicated
// by this phase (no admin/moderation tooling in V1 — module-boundaries.md
// §4.8 Admin is FUTURE).
enum ReportReason {
  UNSAFE_BEHAVIOR
  HARASSMENT
  NO_SHOW
  FRAUD_OR_SCAM
  INAPPROPRIATE_CONTENT
  OTHER
}

model Report {
  id          String        @id @default(cuid())
  reporterId  String
  reportedId  String
  rideId      String?
  reason      ReportReason
  detail      String?
  createdAt   DateTime      @default(now())

  reporter User  @relation("ReportsFiled", fields: [reporterId], references: [id])
  reported User  @relation("ReportsReceived", fields: [reportedId], references: [id])
  ride     Ride? @relation(fields: [rideId], references: [id])

  // - a user's filed reports (self-service history)
  // - reports naming a given user (future admin/moderation use, not built here)
  // - DECIDED (Product owner decision, 2026-08-21): the 5-per-rolling-24h
  //   report rate limit (§11) is enforced by counting this user's recent
  //   rows, not by a new table/column — hence the added composite index
  //   below rather than a separate rate-limit table.
  @@index([reporterId])
  @@index([reporterId, createdAt]) // supports the rolling 24h rate-limit count (§11, DECIDED threshold / SUPPORTED index choice)
  @@index([reportedId])
  @@index([rideId])
}

// PROPOSAL — not applied. A one-directional block: blockerId blocks
// blockedId. Idempotent via the unique constraint: re-blocking while already
// actively blocked is a no-op; re-blocking after an unblock reactivates the
// same row (clears unblockedAt) rather than erroring or duplicating — see
// §13.
//
// DECIDED (Product owner decision, 2026-08-21): unblocking is a SOFT
// DELETE, not a row deletion. `unblockedAt` (null = active block; non-null =
// resolved/inactive) replaces the previously-proposed hard delete, so a
// full block/unblock history per pair is preserved for abuse investigation
// and idempotency.
model Block {
  id          String    @id @default(cuid())
  blockerId   String
  blockedId   String
  createdAt   DateTime  @default(now())
  unblockedAt DateTime? // null = active; set = resolved/inactive (soft delete)

  blocker User @relation("BlocksCreated", fields: [blockerId], references: [id])
  blocked User @relation("BlocksReceived", fields: [blockedId], references: [id])

  @@unique([blockerId, blockedId])
  @@index([blockerId])
  @@index([blockedId])
  @@index([blockerId, unblockedAt]) // "my active blocks" query (GET /blocks/mine, §10)
}
```

`User` would gain four new back-relations (`reportsFiled`, `reportsReceived`,
`blocksCreated`, `blocksReceived`), mirroring how `DevicePushToken` added
`devicePushTokens` to `User` in Phase 3.23. **This is a proposal only — no
schema file has been touched.**

**DECIDED — ride-co-participant scoping (Product owner decision,
2026-08-21):** a report or block may only be created if the
reporter/blocker and the target have, at some point, both held
creator-or-participant status on the _same_ ride — i.e. for that ride, each
of the two users is either `Ride.creatorId` or a `RideParticipant.userId`
row. This eligibility spans two existing tables (`Ride` and
`RideParticipant`) per side and cannot be expressed as a single-column
database FK or CHECK constraint, so it is enforced as an **implied FK/check
at the application layer**: `create-report.ts` / `create-block.ts` (§7) must
query for a ride where both users appear as creator/participant before
writing the `Report`/`Block` row, and reject (proposed 403) if none is
found (§10, §11, §14). This replaces, and resolves, the prior "unrestricted
between any two users" proposal (former §13 text, former §22 item 17).
**INFERENCE remains** only on the exact query shape/optimization and on
whether a `RideRequest`-only relationship (a pending or rejected request,
with no `RideParticipant` row) counts — proposed default: no, only
creator/`RideParticipant` rows count, matching the decision's "creator or
participant" wording; flagged only if this narrower reading needs
confirming.

Deletion vs. soft-delete on unblock: **DECIDED** as soft delete (`Block`
model above, `unblockedAt`) — superseding the prior hard-delete proposal.

Rate limit as config, not schema: **DECIDED** — the 5-reports-per-rolling-
24h threshold (§11) is implemented as a tunable application config constant
and enforced via a query against `Report.createdAt`/`reporterId` (index
above); it is not a schema-level decision and no new table/column is added
to represent it.

---

## 10. API scope (PROPOSAL)

Following the `ride`/`notification` module conventions (`requireAuth`-gated,
`asyncHandler`, `parseRequest` + Zod schemas, `sendData`/`{ data: ... }`
envelope, actor identity always from `getAuthenticatedUser`, never from the
body):

| Method | Path                            | Body                                           | Success                                                          | Notes                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/reports`               | `{ reportedUserId, reason, detail?, rideId? }` | 201, the report row                                              | actor = caller; reject self-report; **DECIDED** (Product owner decision, 2026-08-21) — 403 if caller and `reportedUserId` are not ride co-participants (§9, §11, §13)                                                                                                 |
| GET    | `/api/v1/reports/mine`          | —                                              | 200, caller's filed reports                                      |                                                                                                                                                                                                                                                                       |
| POST   | `/api/v1/blocks`                | `{ blockedUserId }`                            | 201 (or 200 if already actively blocked — idempotent, see §13)   | reject self-block; **DECIDED** — 403 if caller and `blockedUserId` are not ride co-participants (§9, §11, §13); re-POSTing after a prior unblock reactivates the same soft-deleted `Block` row (clears `unblockedAt`) rather than erroring or duplicating             |
| DELETE | `/api/v1/blocks/:blockedUserId` | —                                              | 204                                                              | idempotent: unblocking a non-existent or already-inactive block still 204; **DECIDED** — implemented as a soft delete (`unblockedAt = now()`), not a row deletion (§9); does **not** cancel any existing CONFIRMED participation between the two users (§13, DECIDED) |
| GET    | `/api/v1/blocks/mine`           | —                                              | 200, caller's _active_ blocked-user list (`unblockedAt IS NULL`) |                                                                                                                                                                                                                                                                       |

**INFERENCE** on exact paths/verbs/status codes (proposal, matching the
`device-tokens` precedent's shape); **SUPPORTED** on the pattern itself
(auth-gated, envelope, actor-from-middleware) since that pattern is uniform
across every existing controller reviewed (`ride.controller.ts`,
`device-token.controller.ts`, `auth.controller.ts`). The co-participant
eligibility check (the 403 case) and the soft-delete unblock semantics are
themselves **DECIDED** (Product owner decision, 2026-08-21); only their
exact HTTP status code (403 vs. 404 for the eligibility failure) remains
**INFERENCE** — proposed as 403 (the caller is authenticated and the target
exists, but the action is not authorized for this pair) rather than 404, to
avoid conflating "no shared ride" with "target doesn't exist."

No new "list shared-ride-eligible users to report/block" endpoint is
proposed — the mobile client is expected to surface the report/block action
directly from a ride/participant context it already has loaded (§8), so no
dedicated discovery endpoint is needed; the 403 above is the server-side
enforcement backstop regardless of what the client surfaces.

No GET-by-id / admin-listing / cross-user report visibility endpoints are
proposed — consistent with no admin module existing yet (**CANONICAL**,
`module-boundaries.md` §4.8 Admin = FUTURE).

---

## 11. Security requirements

- **SUPPORTED** (matches every existing module): all endpoints `requireAuth`-gated; actor identity comes only from `getAuthenticatedUser(res)`, never from the request body — a client-supplied `reporterId`/`blockerId` must be ignored/rejected, mirroring the tested behavior in Phase 3.23's device-token endpoints ("client-supplied recipient ignored").
- **DECIDED** (Product owner decision, 2026-08-21): a report or block may only target a user who is (or was) a ride co-participant with the caller — each holds creator-or-participant status on the same ride (§9, §13). A caller cannot report/block an arbitrary user by ID; this is enforced server-side on every create-report/create-block call. Violating requests are rejected (proposed 403, §10).
- **INFERENCE**: reject self-report and self-block (`reportedUserId === callerId` / `blockedUserId === callerId`) with a 400 — not stated anywhere, but an obvious guard needed for a coherent feature; proposed, not decided.
- **INFERENCE**: the reported/blocked target must be a real, existing `User` id (404 if not) — same reasoning as above.
- **DECIDED** (Product owner decision, 2026-08-21): report submission is rate-limited to **5 reports per rolling 24-hour window per reporting user**. PRD §15's "abuse prevention (rate limiting, duplicate prevention)" already establishes the principle (**CANONICAL**); the specific threshold is now settled by the product owner rather than left as an open numeric decision. The threshold is a **tunable configuration constant** (not hardcoded inline, not a schema-level decision) — e.g. `SAFETY_REPORT_RATE_LIMIT_MAX = 5` / `SAFETY_REPORT_RATE_LIMIT_WINDOW_HOURS = 24` — following the same config-constant pattern as the existing OTP rate limits (`docs/planning/open-decisions.md` OD-005: "request rate limit 3 per phone per 10 minutes ... configurable"). Enforced by counting the caller's `Report` rows created within the trailing 24 hours (§9 composite index). **INFERENCE remains only** on the storage/enforcement mechanism (in-memory counter vs. a persisted query, mirroring the OD-005 OTP precedent's own open question) — not on the 5/24h number itself.
- **INFERENCE**: duplicate-report prevention — PRD §15's "duplicate prevention" phrase is generic (it also covers ride-request duplicates elsewhere); applying it to reports (e.g. same reporter + same reported + same ride within a short window collapses to one record, or is simply allowed since reports are cheap to file) is not decided; proposed default is "allow multiple reports, no artificial collapsing" since under-reporting is a worse safety failure mode than over-reporting, but this is a judgment call for humans to confirm.
- No report/block data is ever exposed to the reported/blocked user (see §12 Privacy) — **INFERENCE**, standard safety-product practice, not stated in these docs.

---

## 12. Privacy requirements

- **INFERENCE** (standard practice, not canonically stated, but necessary for the feature to be safe): the identity of a reporter is never disclosed to the reported user. Symmetric for blocks — the blocked user is never told who blocked them, nor generally that they were blocked at all (see §16 Notifications).
- **SUPPORTED**: report `detail` free text may contain sensitive content; treat it like other user-generated content already handled by the app (no new logging exposure) — consistent with existing "no PII/secrets in logs" conventions seen in every prior phase's Security section (Phase 3.22 §14, Phase 3.23 §13).
- **INFERENCE**: reports/blocks are not surfaced through any existing "profile view" endpoint that another user can query — i.e., there is no way for user B to discover that user A reported or blocked them via any in-scope API. Flagged in §24 since this constrains future admin-tooling design (an admin view would need explicit new authorization, not built here).
- OD-013 (data retention rules) is OPEN and out of scope for this phase (**CANONICAL** cross-reference, `open-decisions.md` OD-013) — no retention/deletion policy for `Report`/`Block` rows is decided here; they are proposed to persist indefinitely by default, same as every other domain table in the current schema, until OD-013 is resolved.

---

## 13. Reporting/blocking lifecycle

**States:**

- A `Report` is a single immutable record once created — no status field, no lifecycle transitions, no resolution states. **INFERENCE**: chosen because no admin/moderation module exists yet (§6) to _act_ on a report; adding a status enum (`OPEN`/`REVIEWED`/`DISMISSED`) with no consumer would be speculative. Flagged in §24.
- A `Block` has two states, both **DECIDED** (Product owner decision,
  2026-08-21) to be tracked via soft delete rather than row existence alone:
  **active** (`unblockedAt` null) and **resolved/inactive** (`unblockedAt`
  set, i.e. previously unblocked, §9). The row persists across an unblock —
  "does not exist" is no longer a reachable post-unblock state, only "never
  created" or "resolved."

**Who can report/block whom — DECIDED (Product owner decision, 2026-08-21):**

- A user may report or block **only a ride co-participant** — someone who
  is, or was, a creator or participant on a ride that the reporting/
  blocking user also created or participated in (§9, §11). This is **not**
  open to arbitrary user-by-ID reporting/blocking. This supersedes and
  resolves the prior "unrestricted between any two users" proposal (former
  text in this section, former §22 item 17) — it is no longer an open
  question, removed from §22/§24 below.
- Self-report/self-block rejected (§11) — unchanged, still INFERENCE on the
  exact guard/status code.

**Idempotency:**

- Blocking a user with no existing `Block` row: creates a new active row
  (201 proposed). **INFERENCE** on the exact status code.
- Blocking an already-**actively**-blocked user: no-op success (200,
  existing row), not an error — matches the `DevicePushToken` upsert
  idempotency precedent (Phase 3.23 §10: "Upsert ... idempotent,
  reactivates"). **INFERENCE** on the exact status code; the no-op
  principle is unchanged.
- Blocking a user with an existing but **resolved/inactive**
  (previously-unblocked) `Block` row: **DECIDED** mechanism (Product owner
  decision, 2026-08-21) — reactivates the same row (clears `unblockedAt`)
  rather than creating a second row or erroring, per the soft-delete
  retention decision (§9). The exact success status code (200 vs. 201)
  remains **INFERENCE**.
- Unblocking a non-existent or already-inactive block: no-op success (204),
  not a 404 — same idempotency philosophy; now implemented via the
  soft-delete marker (§9, DECIDED) rather than "there was nothing to
  delete."
- Filing multiple reports against the same user: allowed, not deduplicated
  (see §11).

**Effect of blocking — DECIDED (Product owner decision, 2026-08-21):**
when user A blocks user B —

1. B's published rides are excluded from A's discovery/matching results,
   and vice versa (A's rides excluded from B's discovery), going forward
   from the moment of blocking. **DECIDED** in principle — the product
   owner's instruction that blocking "affects future discovery/matching/
   requests going forward" directly covers this. The _exact_ filtering
   mechanics (bidirectional application, whether it also touches
   already-visible-but-not-yet-requested listings) remain **INFERENCE** as
   an implementation detail, not a reopened product question.
2. A cannot submit a new ride request to B's rides, and B cannot accept a
   _new_ request from A, from the moment of blocking going forward.
   **DECIDED** — covered by the same "affects future ... requests"
   instruction. Existing pending requests between them at block time are
   **not** auto-cancelled by the block itself; **INFERENCE** remains only on
   whether such a pending request should be actively surfaced/resolved
   differently going forward, not on whether the block silently cancels it
   (it does not).
3. An existing **CONFIRMED** participation between A and B (already on a
   shared ride together) is **explicitly not severed by a block** —
   **DECIDED** (Product owner decision, 2026-08-21): "Blocking does NOT
   auto-cancel any existing CONFIRMED participation between the two users."
   Either party may still cancel through the existing normal Phase 3.21
   cancellation flow if they want out; the block itself performs no
   cancellation action and triggers no Phase 3.21 lifecycle transition. This
   resolves what was previously flagged as the single largest open item in
   this document (former §22 item 19, former §24 item 3, former §23 "largest
   risk").

This behavior (1–3) is now a **decided requirement**, not a proposal —
implementation should proceed on this basis without seeking further product
sign-off on the underlying principle. Only the specific implementation
details flagged as INFERENCE above (exact filtering query shape, exact
success status codes) still need ordinary engineering judgment, not a
further product decision.

---

## 14. Failure behavior

**SUPPORTED**, matching the uniform pattern already used across every module
(`NotFoundError`, `AuthorizationError`, Zod validation → 400, generic 500 for
unexpected failures, no raw internal errors leaked to clients — same pattern
as `device-token.controller.ts` after its Phase 3.23 fix, §6.2 of that
phase's spec):

- Reporting/blocking a non-existent user → 404, generic message.
- Reporting/blocking a user who is not a ride co-participant of the caller
  → 403 (**DECIDED** scope restriction, §9/§11/§13; the existence check
  above is proposed to run first, so a nonexistent target still yields 404
  rather than 403 — **INFERENCE** on that ordering only).
- Self-report/self-block → 400.
- Malformed body (missing reason, invalid enum value) → 400 via
  `parseRequest`.
- Unauthenticated → 401 (via `requireAuth`, unchanged).
- A failure in the report/block write must never roll back or block an
  unrelated in-flight ride/request operation — **INFERENCE**, by direct
  analogy to Phase 3.23's explicit "push failure must never fail the
  operation" rule (§6.4 of that phase), since a report/block is also a
  side-channel safety action, not a Ride Engine transaction participant.

---

## 15. Realtime requirements

Consulted `docs/planning/phases/phase-3-22.md` (7 realtime events:
`RIDE_REQUESTED`, `REQUEST_ACCEPTED`, `REQUEST_REJECTED`,
`REQUEST_CANCELLED`, `RIDE_CANCELLED`, `RIDE_EXPIRED`, `RIDE_CONFIRMED`) and
`docs/architecture/event-model.md` (zero report/block mentions, confirmed by
search).

- **INFERENCE, proposed as "no new realtime event"**: reporting/blocking do
  not need a realtime push to the _reported/blocked_ user (see §16 — they
  should generally not be notified at all in real time about being reported,
  and a block's effect is felt passively, next time they try to interact,
  not as a live push). No new entry is proposed for the Phase 3.22 event
  catalogue.
- Presence: Phase 3.22 has no presence/online-status feature at all (its own
  §18 "Limitations" lists "No presence, typing indicators, location
  streaming" — **CANONICAL** quote from that phase's own spec), so there is
  no presence system for a block to affect. Room membership (`user:{userId}`)
  is unaffected by blocks — a blocked user's socket connection and room
  membership continue exactly as before; only Ride Engine's _data_ (matching
  results, request eligibility) changes per §13. **SUPPORTED** by Phase
  3.22's own explicit statement that rooms are per-authenticated-identity
  and unrelated to any other user's action.

---

## 16. Notification requirements

Consulted `docs/planning/phases/phase-3-23.md` (push provider, dispatch
pipeline) and the `NotificationType` enum in `schema.prisma` (12 existing
ride-lifecycle types, zero report/block types).

- **DECIDED** (Product owner decision, 2026-08-21): no notification is sent
  to the reported or blocked user in either case. The behavior is fully
  silent from the target's perspective — a report/block never generates a
  `Notification` row, push, or realtime event naming the actor, the fact of
  being reported, or the fact of being blocked. The target may naturally
  notice indirect, unattributed effects over time (e.g. a ride request that
  no longer succeeds, or a previously-visible ride disappearing from
  discovery, §13) but no explicit signal is ever sent. This finalizes what
  the first version of this document proposed on both the reported-user and
  blocked-user points — no human override is pending on either.
- **DECIDED** (same source, and the same reasoning as `schema.prisma`'s
  `Notification` model being scoped to ride-lifecycle events): no new
  `NotificationType` is added for reports/blocks — a report/block is never
  modeled as a `Notification` row, for either party.
- The **reporting/blocking user** gets a simple synchronous HTTP
  201/200/204 confirmation (per §10) and no additional notification-channel
  record. **INFERENCE remains only** on this specific point (whether the
  _actor_ — not the target — might someday want an in-app confirmation
  record); the product owner's decision addresses the target side only, and
  no source proposes an actor-side notification beyond the HTTP response.
- No push dispatch (Phase 3.23 pipeline) is triggered by a report or block,
  for either party. **DECIDED.**

---

## 17. Dependencies

- **Phase 3.18** (CANONICAL, resolved OD-005): bearer-token auth,
  `AuthenticatedUser`, `getAuthenticatedUser` — every new endpoint reuses this
  unchanged.
- **Phase 3.21**: request/participant lifecycle — consulted for §13 item 3
  (existing CONFIRMED participation is a Phase 3.21-owned concern; this
  phase does not touch it — DECIDED, Product owner decision, 2026-08-21).
- **Phase 3.22**: realtime — consulted for §15; no changes proposed to the
  event catalogue, room strategy, or publisher.
- **Phase 3.23**: notifications/push — consulted for §16; no changes
  proposed to `NotificationType`, the notification-draft pipeline, or push
  dispatch.
- Does **not** depend on OD-010 or any verification mechanism (§4, §6).

---

## 18. Acceptance criteria

- [x] Roadmap/open-decisions scope note recorded (this session's Part 1 —
      already done, see §24 confirmation in the calling report)
- [x] `Report` and `Block` models added to `schema.prisma`, including
      `Block.unblockedAt` for soft-delete (§9 — DECIDED), migration
      generated (`20260821183252_phase_3_24_reporting_blocking`)
- [x] `POST /api/v1/reports` implemented, authenticated, self-report
      rejected, non-existent target rejected, **403 when caller and target
      are not ride co-participants (§9, §11, §13 — DECIDED)**
- [x] `GET /api/v1/reports/mine` implemented, owner-scoped
- [x] `POST /api/v1/blocks` implemented, idempotent — including reactivation
      of a previously-unblocked row (§13 — DECIDED) — self-block rejected,
      **403 when caller and target are not ride co-participants (DECIDED)**
- [x] `DELETE /api/v1/blocks/:blockedUserId` implemented, idempotent, as a
      **soft delete (`unblockedAt`), not a row deletion (§9 — DECIDED)**
- [x] `GET /api/v1/blocks/mine` implemented, owner-scoped, returns only
      currently-active blocks (`unblockedAt IS NULL`)
- [x] Blocking excludes the blocked pair from each other's discovery/matching
      results going forward — one isolated `NOT EXISTS` clause in
      `ride.repository.ts`'s discovery query, driven by an optional
      `viewerId` (§13, §21)
- [x] Blocking prevents new requests between the blocked pair going forward
      (§13 — DECIDED), via `isBlockedPair` in `create-ride-request.ts`
- [x] Blocking does **not** cancel an existing CONFIRMED participation
      between the blocked pair (§13 — DECIDED); either party may still use
      the existing normal cancellation flow
- [x] Reported/blocked identity never disclosed to the reported/blocked user
      (§12, §16)
- [x] No notification, push, or realtime event of any kind is sent to the
      reported or blocked user (§16 — DECIDED)
- [x] No new realtime event added (§15) — `REALTIME_EVENT_TYPES` is still the
      same seven events
- [x] No new `NotificationType` added (§16 — DECIDED, not merely proposed)
- [x] Report rate limiting enforced at **5 reports per rolling 24-hour
      window per reporting user**, implemented as a tunable config constant
      (`REPORT_RATE_LIMIT_MAX` / `REPORT_RATE_LIMIT_WINDOW_HOURS`, §11)
- [x] OD-010 unaffected — no verification mechanism/provider/policy touched
- [x] Backend/mobile tests, typecheck, lint, build, format:check pass (§20)
- [x] Prisma validate / migrate status / db:check pass
- [x] No Phase 3.25+ (chat) work implemented

All boxes above are implemented and verified — see
`docs/development/phase-3-24-notes.md` for the verification record. The items
marked DECIDED no longer need further product sign-off on the underlying
principle; the INFERENCE items still listed in §22 and the open items in §24
remain open as documented and are unaffected by this implementation.

---

## 19. Testing requirements

**SUPPORTED** — mirrors the test-category breadth already used in Phase
3.22/3.23 (unit + repository + HTTP-contract + integration + security
tests):

Backend:

- Domain rules: self-report/self-block rejection, reason enum validation
- Repository: create report, create/remove block, idempotent re-block,
  idempotent unblock, list-by-user queries
- HTTP contract: 201/200/204 happy paths, 400 on malformed body, 404 on
  unknown target, 403 when caller/target are not ride co-participants (§9,
  §11, §13 — DECIDED), 401 unauthenticated, client-supplied actor id ignored
  (mirroring the Phase 3.23 "client-supplied recipient ignored" test)
- Integration: a block excludes the blocked pair from discovery/matching
  results going forward; a block does **not** retroactively cancel an
  existing CONFIRMED participation (per the §13 decision, not merely a
  proposal); a report/block against a non-co-participant is rejected even
  when both users otherwise exist; unblocking soft-deletes (`unblockedAt`
  set, row retained) and a subsequent re-block reactivates the same row
  (§9, §13 — DECIDED); the 6th report within a rolling 24h window from the
  same user is rejected while the 5th succeeds (§11 — DECIDED threshold); a
  report/block failure does not roll back or fail an unrelated ride
  operation (per §14)
- Security: reported/blocked user identity never appears in any response
  visible to the counterparty; no `Notification`/push/realtime record is
  ever created naming the reporter/blocker to the reported/blocked user
  (§16 — DECIDED)

Mobile:

- API client: report/block/unblock/list calls, error normalization
- Hooks: `useReport`/`useBlock` state transitions, optimistic-update rollback
  on failure (if the UI does optimistic updates — INFERENCE, UI detail)
- Screens: report submission flow, blocked-users list, unblock action

---

## 20. Quality gates

**SUPPORTED** — identical gate set to every prior 3.x phase (Phase 3.22 §16,
Phase 3.23 §16):

- Backend: `typecheck`, `lint`, `test`, `build`
- Mobile: `typecheck`, `lint`, `test`
- Repository: `format:check`
- Database: `prisma validate`, `prisma migrate status`, `db:check`
- Expo: `expo config --type public`
- Health endpoint: `GET /health` → 200

---

## 21. Rollback considerations

- **INFERENCE**: the `Report`/`Block` tables and their endpoints are
  additive and isolated — no existing table gains a required column, no
  existing endpoint's behavior changes except the _discovery/matching_
  query (§13 item 1), which gains an additional exclusion filter. Rollback
  = revert the migration and the new module; the discovery/matching filter
  should be written so its removal is a single, isolated code change (e.g.
  one additional `WHERE NOT EXISTS (...)` clause / repository-level filter),
  not threaded through multiple call sites, to keep rollback low-risk.
- The §13 item-3 decision (existing CONFIRMED participation untouched by a
  block) is now DECIDED, not merely proposed. If a human later overrides
  this to instead sever active participation on block, that would touch
  Phase 3.21's cancellation logic and should be scoped as a separate,
  explicitly-approved change — not folded silently into this phase's
  rollout.

---

## 22. Assumptions

(Every remaining INFERENCE item above is restated here for a single-place
human review. Five items from the first version of this list — unrestricted
reporting/blocking between any two users, the rate-limit threshold being
undecided, hard-delete-on-unblock, whether blocking cancels an existing
CONFIRMED participation, and whether a notification is sent to the
report/block target — were **resolved by Product owner decision,
2026-08-21** and are removed from this list; see §5, §9, §11, §13, §16 for
the decided behavior. The existence of unblocking itself (formerly item 1)
is likewise no longer a bare assumption, since the retention decision
presupposes it — see §5.3, §9.)

1. A self-service report/block listing view is in scope (§5.4).
2. Existing profile fields (name) already satisfy PRD §15's "user safety
   info on profile" — no new profile schema is added (§5.6).
3. No admin/moderation queue, automated suspension, or trust-scoring from
   reports (§6).
4. Safety module may be queried (read-only) by Ride Engine discovery/request
   flows to filter blocked pairs (§7).
5. Proposed file/module layout and naming (§7, §8) are illustrative, not
   binding.
6. Mobile screen names, entry points, and UX flow are placeholders (§8).
7. `Report`/`Block` schema shapes beyond what's now decided —
   `ReportReason` enum values and exact index choices remain proposals
   (§9); soft-delete-on-unblock and the ride-co-participant eligibility
   check are no longer assumptions (both DECIDED, §9).
8. Proposed API paths/verbs/status codes, including the exact 200-vs-201
   code for a re-block-after-unblock reactivation and the exact status code
   (proposed 403) for a co-participant-scope violation (§10).
9. Self-report/self-block rejection; target-must-exist validation; the
   ordering of the 404-vs-403 check when both could apply (§11, §14).
10. Exact rate-limit enforcement mechanism (in-memory counter vs. a
    persisted query against `Report.createdAt`) — the 5-per-24h threshold
    itself is DECIDED (§11); only the storage/enforcement mechanism is
    still open.
11. No artificial duplicate-report collapsing; duplicates are allowed (§11).
12. Reporter/blocker identity is never disclosed to the counterparty (§12).
13. No existing endpoint discloses report/block facts to the affected user
    (§12).
14. `Report`/`Block` rows persist indefinitely by default pending OD-013
    (§12).
15. `Report` has no status/lifecycle field; no admin consumer exists yet
    (§13).
16. Exact query shape/optimization for the ride-co-participant eligibility
    check, and whether a pending-only `RideRequest` relationship (no
    `RideParticipant` row) counts as "participant" — proposed default: no
    (§9, §13).
17. Exact filtering mechanics of the discovery/matching exclusion
    (bidirectional scope; whether it also touches already-visible listing
    state beyond blocking new requests) (§13).
18. Report/block failures never roll back or fail an unrelated ride
    operation (§14).
19. No new realtime event is added for reports/blocks (§15).

---

## 23. Risks

- **Silent scope drift into moderation**: because reports are recorded but
  never adjudicated in this phase (no admin module), there is a risk that
  "reporting" is perceived by users as triggering action when it currently
  only creates a record. Mitigate with clear in-app copy (mobile UX,
  out of scope for this backend-focused spec but worth flagging to product).
- **Discovery-filter correctness**: adding a blocked-pair exclusion to the
  discovery/matching query (already OD-004-resolved, deterministic,
  performance-sensitive per `docs/domain/matching-model.md` §6) risks
  regressing the existing deterministic ranking/performance guarantees if
  implemented carelessly (e.g. an unindexed subquery). Needs a
  correctness+performance test pass against the existing Phase 3.19 matching
  test suite, not just new tests.
- **Report-spam / harassment-via-reporting**: non-deduplicated reporting
  (§11, §22 item 11) could itself be abused (mass false-reporting a
  disliked user), though the DECIDED ride-co-participant scoping (§9, §13)
  and the DECIDED 5-per-24h rate limit (§11) both narrow this risk
  meaningfully compared to the first version of this document (which
  proposed unrestricted reporting with only a rate limit of undecided
  size). No mitigation beyond those two now-decided limits is proposed here
  since no moderation/admin consumer exists to act on volume yet — flagged,
  not fully solved.
- **User expectation mismatch on "block ≠ leave the ride"**: the product
  owner has now decided (2026-08-21, §13) that blocking does not sever an
  existing CONFIRMED participation. The design ambiguity that previously
  made this the single largest open item in this document is resolved, but
  a residual support/trust risk remains: a user may still _expect_ blocking
  to remove them from a shared ride they're already confirmed on, and it
  will not. Mitigate with clear in-app copy at block time (mobile UX,
  out of scope for this backend-focused spec but worth flagging to product)
  explaining that an existing confirmed ride is unaffected and the normal
  cancellation flow is the way out.

---

## 24. Explicitly unresolved items

> **Resolved on 2026-08-21 (Product owner decision) — removed from this
> list:** the risk-register R6 phase-label conflict (formerly item 2 below,
> now fixed — `docs/planning/risk-register.md` R6's Owner/Phase column reads
> "Product+Safety / 1", matching the file's own V1-baseline convention); the
> effect of blocking on an existing CONFIRMED participation (formerly item
> 3); whether reporting/blocking is restricted to ride co-participants
> (formerly item 4); and the report rate-limit threshold (formerly item 5).
> Two further points that were only INFERENCE assumptions (§22), not
> separately numbered here, are also resolved: unblock retention as
> soft-delete, and the silence of notifications toward the reported/blocked
> target. See §5, §9, §10, §11, §13, §16 for the decided behavior. **None of
> these resolutions touch OD-010**, which remains fully OPEN below.

1. **Full identity verification (OD-010)** — remains entirely OPEN and out of
   scope. This phase makes no design decision toward method, mandatoriness,
   provider selection, or lifecycle. A future phase must be scoped only
   after OD-010 is explicitly resolved (per `docs/planning/roadmap.md`'s
   standing rule).
2. **Whether a report needs a status/lifecycle field** in anticipation of a
   future admin/moderation module, or whether that can be added later
   without migration pain (§13, §22).
3. **Data retention** for `Report`/`Block` rows in general (beyond the
   now-decided soft-delete marker on `Block` itself, §9) — depends on
   OD-013 (data retention rules), also OPEN.
4. **Whether "user safety info on profile" (PRD §15) requires any new
   profile field** beyond existing `name`, or is satisfied as-is (§5.6,
   §22).

---

## 25. Phase boundary

**In this phase:** reporting, blocking, unblocking, self-service listing of
one's own reports/blocks, minimal discovery/matching-visibility effect of a
block, backend + mobile module scaffolding per §7–§10, tests per §19,
documentation of the scope narrowing (this session's Part 1).

**Explicitly not in this phase:** identity verification of any kind (§6),
OD-010 resolution (§4), admin/moderation tooling, automated
suspension/trust-scoring, chat (Phase 3.25), payments, any change to
`AuthSession`/OTP/Phase 3.18 auth, any change to the Phase 3.22 realtime
event catalogue or Phase 3.23 notification pipeline beyond "add no new
entries" (§15, §16).

**Next phase after this one is implemented:** verification/KYC scoping,
which cannot begin until OD-010 is explicitly decided by the product owner.
