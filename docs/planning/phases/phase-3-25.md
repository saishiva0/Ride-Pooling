# Phase 3.25 — Chat / Communication (Deferred to V1.1)

> Status: **DEFERRED TO V1.1** — planning placeholder only
> Decision: **OD-009 RESOLVED → V1.1**
> Predecessor: Phase 3.24 (complete). This is NOT an implementation phase and
> does NOT start Chat implementation.

---

## 1. Status

**DEFERRED TO V1.1.** This document records the OD-009 scope decision and
preserves Phase 3.25 as a V1.1 planning placeholder. No Chat implementation is
part of V1.

## 2. Decision

OD-009 — Ride chat/communication in V1 or V1.1? — is **RESOLVED**: **V1.1**.

- Decision: Chat/communication is deferred to V1.1.
- Scope: V1.1 ride-based communication feature.
- Current V1: No Chat implementation is required.
- Future: Chat will be planned and implemented as a V1.1 capability after V1
  release readiness.

## 3. Objective

Record the product decision that ride chat/communication belongs to V1.1, keep
V1 focused, and preserve a future phase placeholder for detailed Chat
planning.

## 4. Reason for deferral

V1 remains focused on the core ride lifecycle, discovery, matching, requests,
participants, notifications, realtime, safety/reporting, and release
readiness. Adding Chat would expand V1 scope beyond the validated core
marketplace loop.

## 5. Current V1 exclusion

No Chat implementation is part of V1. This includes no Chat UI, Conversation
model, Message model, Chat APIs, Chat realtime events, Chat persistence, Chat
notifications, typing indicators, presence, read receipts, Chat migrations,
Chat provider, Chat broker, or Chat dependencies.

## 6. Future V1.1 scope boundary

Chat is a V1.1 ride-based communication capability. Detailed Chat product and
technical requirements will be defined in the V1.1 Chat planning phase. This
document does not define Chat requirements.

## 7. Known dependencies

Future Chat planning may depend on existing V1 foundations:

- Phase 3.18 authentication.
- Phase 3.22 Socket.io realtime.
- Phase 3.23 push notifications.
- Phase 3.24 reporting/blocking.

These foundations do not constitute Chat implementation.

## 8. Existing reusable infrastructure

- Authentication/session model from Phase 3.18.
- Realtime transport/room/auth patterns from Phase 3.22.
- Notification creation/dispatch patterns from Phase 3.23.
- Safety reporting/blocking baseline from Phase 3.24.

These foundations do not constitute Chat implementation.

## 9. Explicitly unresolved future Chat decisions

The following are explicitly unresolved and must be decided during V1.1 Chat
planning:

- 1:1 vs group communication.
- Conversation creation/closure and permissions.
- Message types, limits, editing/deletion, retention.
- Read receipts, typing indicators, presence.
- Attachments/media/location sharing/reactions/search.
- Encryption, moderation, notification behavior.
- API design, database schema, realtime events, broker/provider, feature flags.

No decision is made here.

## 10. Future planning prerequisites

Before Chat implementation can begin:

- OD-009 resolution must remain recorded as V1.1.
- V1 release readiness must be complete.
- A V1.1 Chat planning phase must define product and technical requirements.
- Any Chat phase must not modify OD-010 or OD-013 without explicit decisions.

## 11. Explicit out-of-scope items for current V1

- Chat UI/screens/components.
- Conversation/Message persistence or Prisma models.
- Chat REST/WebSocket APIs or realtime events.
- Chat push/in-app notifications.
- Typing indicators, presence, read receipts.
- Chat moderation/encryption/retention implementation.
- Chat provider/broker/dependencies.

## 12. Phase boundary

Phase 3.25 is a documentation-only OD-009 resolution and V1.1 placeholder. It
is not an implementation phase. No Chat implementation is started by this
phase. Phase 3.25 implementation MUST NOT begin in V1. Chat implementation
belongs to V1.1.
