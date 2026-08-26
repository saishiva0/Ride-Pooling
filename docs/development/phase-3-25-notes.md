# Phase 3.25 — Chat / Communication: OD-009 Resolution Notes

> Status: Phase 3.25 — Complete (documentation-only resolution)
> Date: 2026-08-25
> Resolves: **OD-009 (ride chat/communication in V1 or V1.1?) → RESOLVED:
> V1.1**. No other open decisions are touched. **OD-010 (identity
> verification) and OD-013 (data retention) remain OPEN**, exactly as
> required.

---

## 1. Objective

Resolve OD-009 — whether ride chat/communication belongs to V1 or V1.1 — and
record the resolution canonically. Phase 3.25 is a documentation-only
resolution and V1.1 planning placeholder, not an implementation phase.

---

## 2. Decision

OD-009 is **RESOLVED**: **V1.1**.

- Chat/communication is deferred to V1.1.
- Scope: V1.1 ride-based communication feature.
- Current V1: no Chat implementation is required.
- Future: Chat will be planned and implemented as a V1.1 capability after V1
  release readiness.
- Rationale: V1 remains focused on the core ride lifecycle, discovery,
  matching, requests, participants, notifications, realtime,
  safety/reporting, and release readiness. Adding Chat would expand V1 scope
  beyond the validated core marketplace loop.

---

## 3. What This Phase Changed (documentation only)

- `docs/planning/phases/phase-3-25.md` — created as the DEFERRED TO V1.1
  planning placeholder and OD-009 decision record.
- `docs/planning/open-decisions.md` — OD-009 marked **RESOLVED** with the full
  resolution table; open-questions index updated.
- `docs/planning/roadmap.md` — Phase 3.25 listed as deferred to V1.1 with
  OD-009 resolved.
- Canonical product/domain/architecture documents updated to state that ride
  chat/communication is not part of V1: `docs/product/v1-scope.md`,
  `docs/product/user-flows.md`, `docs/product/product-requirements.md`,
  `docs/architecture/event-model.md`,
  `docs/architecture/system-architecture.md`, `docs/domain/domain-model.md`,
  `docs/architecture/api-boundaries.md`,
  `docs/architecture/module-boundaries.md`, and
  `docs/planning/v1-definition-of-done.md`.
- This notes file.

No application code, Prisma schema, migrations, tests, dependencies, or
configuration files were changed.

---

## 4. What This Phase Did NOT Change

Per the resolution, no Chat implementation exists or was started. Explicitly
excluded from V1:

- Chat UI/screens/components.
- Conversation/Message persistence or Prisma models.
- Chat REST/WebSocket APIs or realtime events (`REALTIME_EVENT_TYPES` is
  unchanged).
- Chat push/in-app notifications (no new `NotificationType`).
- Typing indicators, presence, read receipts.
- Chat moderation/encryption/retention implementation.
- Chat provider/broker/dependencies.

---

## 5. Existing Foundations (not Chat implementation)

Future V1.1 Chat planning may build on these existing V1 foundations, none of
which constitute Chat implementation:

- Phase 3.18 authentication/session model.
- Phase 3.22 Socket.io realtime transport/room/auth patterns.
- Phase 3.23 push notification creation/dispatch patterns.
- Phase 3.24 reporting/blocking safety baseline.

---

## 6. Explicitly Unresolved Future Chat Decisions

The following are explicitly unresolved and must be decided during V1.1 Chat
planning (no decision is made here):

- 1:1 vs group communication.
- Conversation creation/closure and permissions.
- Message types, limits, editing/deletion, retention.
- Read receipts, typing indicators, presence.
- Attachments/media/location sharing/reactions/search.
- Encryption, moderation, notification behavior.
- API design, database schema, realtime events, broker/provider, feature
  flags.

---

## 7. Verification Performed

- No application code was changed, so backend/mobile quality gates are
  unchanged from Phase 3.24 close (backend 1039/1039, mobile 444/444).
- OD-009 resolution cross-checked across all canonical documents listed in
  §3 — all consistently state ride chat/communication is deferred to V1.1.
- This notes file checked against the repository formatting gate.

---

## 8. Next Steps

- Phase 3.25 is closed. Chat implementation MUST NOT begin in V1.
- V1.1 Chat planning may begin only after V1 release readiness is complete,
  and must define product and technical requirements before any
  implementation.
- Any future Chat phase must not modify OD-010 or OD-013 without explicit
  decisions.
