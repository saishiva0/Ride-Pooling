# Phase 3.25 — V1.1 Chat Implementation Specification

> Status: **PROPOSED — V1.1 planning specification**
> Decision: **OD-009 RESOLVED → V1.1**
> This document defines the implementation scope that must be approved before Chat code is started.

## 1. Objective

Implement a ride-scoped communication capability for V1.1 using the existing authenticated API, Socket.io realtime transport, notification/push infrastructure, and Phase 3.24 safety primitives.

## 2. Conversation model

- One conversation is created per eligible ride.
- The conversation is a group conversation containing the ride creator and confirmed ride participants.
- No arbitrary user-to-user conversations exist.
- Eligibility is derived from the ride/participant relationship; callers cannot choose recipients independently.

## 3. Lifecycle

- Conversation becomes available when the ride has at least one confirmed participant.
- Creator and confirmed participants may access the conversation while the ride is CONFIRMED or IN_PROGRESS.
- New messages are rejected after the ride leaves the active communication states.
- Existing messages remain readable as history after closure.
- No conversation is created for a ride with no confirmed participants.

## 4. Messages

V1.1 supports text messages only.

- Maximum message length: 2000 Unicode characters.
- Empty/whitespace-only messages are rejected.
- Server normalizes/validates message content before persistence.
- No attachments, images, files, audio, video, location sharing, reactions, editing, or deletion in this phase.
- Message timestamps are server-generated UTC timestamps.
- Message sender identity always comes from authenticated identity.

## 5. Persistence and retention

Messages are persisted in PostgreSQL and remain available as ride communication history.

- No automatic retention purge is introduced in this phase.
- Message history is not deleted merely because a ride becomes closed.
- No local-only message source of truth is introduced on mobile.

## 6. Read state

- Per-user unread state is required.
- Reading a conversation marks its messages as read for the authenticated user.
- Unread count is the number of messages in the conversation newer than the user's read position.
- Read state is scoped to the authenticated user and conversation.
- Read receipts visible to other participants are out of scope.

## 7. Typing and presence

Typing indicators and online/presence status are **out of scope** for V1.1 Chat.

## 8. Notifications

- New chat messages use the existing notification/push pipeline.
- A sender does not receive a notification for their own message.
- Notification delivery is best-effort and must never roll back message persistence.
- Existing notification persistence remains authoritative for offline recovery.
- Chat notification preferences are not introduced in this phase; existing notification behavior applies.

## 9. Safety: blocking and reporting

- Existing block rules must prevent a blocked participant from sending new chat messages where the existing safety model requires communication to be disabled.
- Chat must not bypass Phase 3.24 reporting/blocking authorization.
- Existing reporting primitives are reused; Chat does not invent a second moderation system.
- Reporting a message must identify the ride/conversation and message to the existing reporting subsystem.
- Moderation consumption/workflows remain outside this phase unless already provided by Phase 3.24.

## 10. API surface

Authenticated REST endpoints under `/api/v1`:

- `GET /rides/:rideId/chat` — retrieve the authenticated user's ride conversation and recent/history messages.
- `POST /rides/:rideId/chat/messages` — create a text message.
- `PATCH /rides/:rideId/chat/read` — advance the authenticated user's read position.
- `POST /rides/:rideId/chat/messages/:messageId/report` — report a message through existing safety infrastructure.

No caller-supplied sender or recipient IDs are accepted.

## 11. Realtime events

Reuse the existing authenticated Socket.io infrastructure and server-controlled user rooms.

New typed events:

- `CHAT_MESSAGE_CREATED`
- `CHAT_READ_UPDATED`

Chat events contain only the minimum data needed by recipients and never expose credentials, internal database records, or unrelated participant data.

Message creation is persisted first; realtime delivery occurs post-commit and remains best-effort.

## 12. Database model

Introduce explicit Prisma persistence for:

- `ChatConversation`: one ride-scoped conversation, unique by ride.
- `ChatMessage`: conversation, authenticated sender, server timestamp, text content.
- `ChatReadState`: conversation/user read position.

Foreign keys must enforce ownership relationships. Appropriate indexes must support ride lookup, conversation message ordering, unread/read-state queries, and sender lookup.

No database-level deletion of ride/user history is introduced by this phase.

## 13. Mobile experience

Add authenticated Chat UI to the existing ride experience:

- Chat entry from eligible ride details/active ride context.
- Ride Chat screen with chronological message list.
- Text composer with validation and send action.
- Loading, empty, error, and closed-conversation states.
- Unread indicator using server-authoritative read state.
- Realtime messages update the active conversation without replacing REST recovery.
- Conversation history loads through REST when opening/recovering the screen.
- Report-message action uses the existing safety flow.

No typing indicator, presence UI, media picker, attachment UI, or location sharing UI.

## 14. Realtime/recovery behavior

- REST is authoritative for persistence and recovery.
- Socket.io is delivery only.
- Reconnection must not fabricate missed messages.
- On reconnect or screen re-entry, the client refreshes conversation state from REST.
- Duplicate realtime message delivery must not create duplicate persisted messages.

## 15. Authorization and security

- Every Chat operation requires the existing authenticated identity.
- Only the ride creator and confirmed participants may read/send in the ride conversation.
- A caller cannot supply another sender, participant, or recipient identity.
- Closed rides permit history reads but reject new messages.
- Raw Prisma errors and internal details never reach HTTP or realtime clients.
- Message content is treated as untrusted input.

## 16. Explicit non-goals

- 1:1 arbitrary messaging.
- Typing indicators.
- Presence/online status.
- Read receipts visible to other users.
- Attachments/media/audio/video.
- Location sharing.
- Message editing/deletion.
- Message reactions/search.
- End-to-end encryption.
- New broker or realtime transport.
- New push provider.
- New authentication mechanism.
- New moderation backend.
- Offline write queue or event replay.

## 17. Acceptance criteria

1. Only authenticated ride creator/confirmed participants can access an eligible ride chat.
2. A ride has at most one ChatConversation.
3. Text messages persist transactionally with server identity and timestamp.
4. Invalid/empty/over-limit messages are rejected with the existing error contract.
5. Closed rides reject new messages while preserving readable history.
6. Read state is user-scoped and idempotent.
7. Chat messages are delivered through existing authenticated Socket.io rooms after commit.
8. Failed realtime/push delivery never rolls back a persisted message.
9. REST recovery returns authoritative message history after reconnect/offline periods.
10. Sender identity and recipients cannot be caller-controlled.
11. Blocking/reporting rules cannot be bypassed through Chat.
12. No secrets, raw Prisma records, or internal errors are exposed.
13. Backend unit/integration tests cover authorization, lifecycle, persistence, concurrency, read state, safety, realtime and rollback behavior.
14. Mobile tests cover loading/error/empty/closed states, sending, history recovery, realtime updates and unread state.
15. Existing backend/mobile regression suites remain green.

## 18. Dependencies

Uses existing:

- Phase 3.18 authentication/session.
- Phase 3.22 Socket.io realtime.
- Phase 3.23 notification/push infrastructure.
- Phase 3.24 reporting/blocking primitives.

No new external provider is required for Chat transport.

## 19. Decision boundaries

This specification does not resolve OD-010 or OD-013. Any behavior requiring a new identity-verification or retention/moderation policy must stop and be documented rather than invented.

## 20. Implementation boundary

Implementation may begin only after this V1.1 specification is accepted as the working Chat scope. Implementation must remain limited to this document; any material product-policy deviation requires a planning update before code changes.
