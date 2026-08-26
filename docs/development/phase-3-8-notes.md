# Phase 3.8 — Notifications: Implementation Notes

> Status: Phase 3.8 — Implementation
> Records how the persistent in-app notification foundation was built around
> the existing Ride Engine. `docs/architecture/event-model.md` §2.1 is the
> authoritative event catalogue; `docs/domain/domain-model.md` §2.7 defines the
> `Notification` model. This note records what was implemented and why. No
> product decision is resolved here: the push-delivery provider (OD-008) stays
> OPEN, and no push/FCM/APNs/Expo/SMS/email/WebSocket/UI/API is implemented.

## 1. Purpose and boundary

Phase 3.8 adds the **persistent, in-app notification foundation** and wires it
into the Ride Engine. It is NOT push delivery, device registration,
authentication, authorization middleware, notification UI, mobile screens,
HTTP APIs, or an event bus/outbox — those are later phases. The notification
system works first as a persistent domain capability: a ride event produces a
`Notification` row, atomically with the Ride Engine operation that caused it.

```
Ride Engine operation succeeds
  → event → notification mapping layer (WHO receives WHAT)
  → notification insert inside the SAME transaction
  → COMMIT → notification durable with the state change
  (failure anywhere → ROLLBACK → no orphan notification)
```

## 2. Module layout

```
modules/notification/
  domain/            notification-rules.ts        — pure, deterministic type catalogue
  application/       create-notification.ts       — standalone create use case
                     list-notifications.ts        — newest-first listing + unread count
                     mark-notification-as-read.ts — single read-state update (owner only)
                     mark-all-notifications-as-read.ts
                     notification-content.ts      — centralized title/body mapping
                     notification-mapping.ts      — event → notification draft builders
                     notification-dependencies.ts — shared persistence port + defaults
  infrastructure/    notification.repository.ts   — the only Prisma access
```

The Ride Engine does NOT import `createNotification`; it writes notifications
through its own persistence ports (`persistNotification`) bound to the SAME
transaction client, using the mapping layer's drafts. The standalone
`createNotification` service is the application-level create for direct use.

## 3. Supported notification types

Exactly the six events whose Ride Engine operations are implemented
(`event-model.md` §2.1). No arbitrary types were invented:

| Type               | Trigger (Ride Engine operation)                   |
| ------------------ | ------------------------------------------------- |
| `RIDE_REQUESTED`   | request created (`createRideRequest`, Phase 3.5)  |
| `REQUEST_ACCEPTED` | request accepted (`acceptRideRequest`, Phase 3.6) |
| `REQUEST_REJECTED` | request rejected (`rejectRideRequest`, Phase 3.6) |
| `RIDE_CANCELLED`   | ride cancelled (`cancelRide`, Phase 3.7)          |
| `RIDE_EXPIRED`     | ride expired (`expireRide`, Phase 3.7)            |
| `RIDE_CONFIRMED`   | first accept (PUBLISHED → CONFIRMED, Phase 3.6)   |

Other enum values (`RIDE_CREATED`, `RIDE_PUBLISHED`, `RIDE_UPDATED`,
`REQUEST_CANCELLED`, `RIDE_STARTED`, `RIDE_COMPLETED`) are valid `NotificationType`
values but **not supported for creation in this phase** — `notification-rules.ts`
guards this and `notification-content.ts` throws `ValidationError` for them, so
an unsupported type can never reach persistence with a fabricated message.

## 4. Event → notification mapping

`application/notification-mapping.ts` is the only place that knows who receives
what. Each builder takes only identifiers already proven valid by the successful
operation, so a notification is emitted only for an operation that succeeded.
It contains NO Ride Engine business rules (states, seats, locking stay in the
Ride Engine).

| Event              | Recipients                                 |
| ------------------ | ------------------------------------------ |
| `RIDE_REQUESTED`   | the ride creator                           |
| `REQUEST_ACCEPTED` | the requester                              |
| `REQUEST_REJECTED` | the requester                              |
| `RIDE_CANCELLED`   | creator + confirmed participants (deduped) |
| `RIDE_EXPIRED`     | creator + confirmed participants (deduped) |
| `RIDE_CONFIRMED`   | creator + the confirmed requester          |

Notes:

- Ride-scoped drafts (`RIDE_CANCELLED`/`RIDE_EXPIRED`/`RIDE_CONFIRMED`) always
  include the creator and dedupe recipient ids (`dedupe` preserves first-seen
  order), so a creator who is also a participant is notified once.
- An EXPIRED ride is by definition still `PUBLISHED` (only `PUBLISHED` rides
  expire), so it has no confirmed participants; in practice only the creator
  receives `RIDE_EXPIRED` today. The mapping is written generally so a future
  rule change cannot silently drop recipients.

## 5. Content model

`application/notification-content.ts` is the single place that decides the
human-readable `title` / `body` for a type (no markup, no emoji, no
channel-specific formatting). Ride Engine operations never format their own
notification text. Content is deliberately concise and suitable for a future
mobile client:

| Type               | Title                 | Body                                 |
| ------------------ | --------------------- | ------------------------------------ |
| `RIDE_REQUESTED`   | New ride request      | `<name> requested to join your ride` |
| `REQUEST_ACCEPTED` | Ride request accepted | Your ride request was accepted       |
| `REQUEST_REJECTED` | Ride request rejected | Your ride request was declined       |
| `RIDE_CANCELLED`   | Ride cancelled        | A ride you joined was cancelled      |
| `RIDE_EXPIRED`     | Ride expired          | A ride you joined has expired        |
| `RIDE_CONFIRMED`   | Ride confirmed        | Your ride is confirmed               |

## 6. Persistence model

The Phase 2 `Notification` model (`schema.prisma` §2.7) already supported this
phase — **no schema change and no migration were required**.

- `userId` → `User` (`ON DELETE RESTRICT` — a user with notifications cannot be
  deleted first; integration test cleanups remove notifications before users).
- `rideId` / `requestId` → `Ride` / `RideRequest` (`ON DELETE SET NULL`).
- `readAt DateTime?` — NULL means unread; a timestamp means read.
- Indexes: `(userId, createdAt)` for listing, `(userId, readAt)` for the unread
  badge, `(rideId)`, `(requestId)`.

The repository (`infrastructure/notification.repository.ts`) is the only Prisma
access: `persistNotification`, `findNotificationById`,
`findNotificationsForRecipient` (newest first, `createdAt DESC, id DESC`
tiebreak, `limit + 1` probe), `countUnreadNotifications`,
`markNotificationRead` (updateMany with `readAt: null` predicate — race-safe),
`markAllNotificationsRead`, `findNotificationRecipient`,
`classifyNotificationError` (P2003 → `foreign_key`).

Application services return `AppNotification` (id, recipientUserId, type,
title, body, read, readAt, rideId, requestId, createdAt) — never raw Prisma
records.

## 7. Read/unread semantics

- Unread ⇔ `readAt IS NULL`; read ⇔ `readAt` set. `AppNotification.read` is
  derived from `readAt`.
- `markNotificationAsRead`: loads the notification, checks ownership, and for
  an already-read notification returns the current state WITHOUT a write
  (idempotent — `readAt` is never rewritten). The update itself is an
  `updateMany(id + userId + readAt IS NULL)`, so a concurrent read/delete
  simply matches zero rows.
- `markAllNotificationsAsRead`: one `updateMany(userId + readAt IS NULL)`;
  already-read notifications are never modified; returns `{ updatedCount }`.
  An unknown user is a successful no-op (`updatedCount: 0`).
- `listNotifications` returns the recipient's unread count alongside the page.

## 8. Ownership / security behavior

- Listing is strictly scoped by `userId` (the repository `where` clause) — a
  user can never see another user's notifications.
- `markNotificationAsRead` enforces ownership in the application layer
  (`record.userId !== userId` → `AuthorizationError`, 403) AND in the write
  predicate (`updateMany` with `userId`), so the database is a second guard.
- `markAllNotificationsAsRead` is scoped by `userId` only.
- Authentication is not implemented yet: `userId`/`recipientId` are trusted
  application input. **Authorization will be enforced at the API boundary when
  authentication lands (later phase).** This mirrors the Ride Engine's
  `actorId` convention.

## 9. Transaction behavior

Notification persistence is **atomic with the Ride Engine state change**
(Phase 3.8 §10). Each wired operation runs inside its existing single
`prisma.$transaction`; the notification insert goes through the SAME
transaction client:

```
Accept request (accept-ride-request.ts):
  lock ride (FOR UPDATE) → validate → create participant → update request →
  update ride (first accept) → write status history →
  persistNotificationDrafts(REQUEST_ACCEPTED, [RIDE_CONFIRMED on first accept])
  COMMIT
```

If any write fails, the whole transaction rolls back — including the
notifications. Verified by integration tests:

- A rejected acceptance (insufficient seats, 422) persists no participant, no
  request/ride state change, and no notifications.
- A duplicate active request (409) creates no duplicate `RIDE_REQUESTED`.
- A notification inserted inside a deliberately failing transaction is rolled
  back (no orphan row).

No event bus, outbox, Kafka/RabbitMQ/Redis streams, or microservices were
introduced — the transaction is the consistency mechanism, per the phase spec.

## 10. Idempotency approach

- **Application operations are already idempotent where required**: a repeated
  acceptance/rejection of the same request fails with `ConflictError` before
  any write (no duplicate notifications), a duplicate active request fails
  with `ConflictError`, and ride cancellation/expiration write no duplicate
  history rows. Since notifications are written only on the success path of
  these operations, repeated application calls cannot double-notify.
- The schema has no natural idempotency key for notifications; per the phase
  spec, no schema change was invented for this. Within a single transaction a
  draft is inserted exactly once.
- Mark-read operations are naturally idempotent (see §7).

## 11. Error model (reused from lib/errors.ts)

| Condition                                   | Error                          |
| ------------------------------------------- | ------------------------------ |
| Malformed input (empty ids, bad limit/type) | `ValidationError` (400)        |
| Missing recipient (or P2003 FK race)        | `NotFoundError` (404)          |
| Marking another user's notification read    | `AuthorizationError` (403)     |
| Unsupported notification type               | `ValidationError` (400)        |
| Unexpected persistence failure              | `InternalError` (500), wrapped |

Raw Prisma errors never escape application boundaries (`classifyNotificationError`
translates P2003 → `NotFoundError`; everything else → `InternalError`).

## 12. Testing

- **Unit (7 files, 67 tests, no DB):** `notification-rules.test.ts` (catalogue +
  guards), `notification-content.test.ts` (content per type, rejection of
  unsupported types), `notification-mapping.test.ts` (draft builders, dedupe,
  draft fan-out), `create-notification.test.ts` (validation, recipient
  existence, content defaults/overrides, FK-race translation, result mapping —
  no raw Prisma leakage), `list-notifications.test.ts` (newest-first, limit +
  hasMore, unread count, recipient scoping, validation),
  `mark-notification-as-read.test.ts` (ownership, idempotency, missing,
  validation), `mark-all-notifications-as-read.test.ts` (count, scoping,
  idempotent no-op, validation).
- **Integration (2 files, 23 tests, real PostgreSQL):**
  - `notification.integration.test.ts` — create/persist + typed result, NULL
    context normalization, missing recipient (NotFound, nothing persisted), FK
    failure persists nothing, newest-first listing with explicit timestamps,
    hasMore trimming, recipient isolation, unread counting, mark-one read +
    idempotency, cross-user mark rejection, mark-all scoping + count +
    idempotency, and a genuine mid-transaction rollback.
  - `ride-notification.integration.test.ts` — the six documented flows A–F
    against the real Ride Engine use cases (request created → creator
    `RIDE_REQUESTED`; accepted → requester `REQUEST_ACCEPTED`; rejected →
    requester `REQUEST_REJECTED`; cancelled → creator + confirmed participants
    `RIDE_CANCELLED`; expired → creator `RIDE_EXPIRED`; first accept →
    creator + requester `RIDE_CONFIRMED`, none on later accepts), plus no
    notification for failed operations (insufficient seats, duplicate request).
- The existing Ride Engine unit tests were extended with the new persistence
  port methods (`createNotification`, `findConfirmedParticipantIds`) — a
  genuine integration requirement, no test was deleted or weakened — and the
  existing integration test cleanups now remove notifications before users
  (the `Notification.userId` FK is `ON DELETE RESTRICT`).
- Fixtures follow the established conventions (RUN_ID prefixes, Hyderabad base
  coordinates, scoped count queries, cleanup in `afterAll`).

## 13. Files changed

- **New (module):** `modules/notification/domain/notification-rules.ts`,
  `modules/notification/application/{create-notification,list-notifications,
mark-notification-as-read,mark-all-notifications-as-read,
notification-content,notification-mapping,notification-dependencies}.ts`,
  `modules/notification/infrastructure/notification.repository.ts`,
  `modules/notification/README.md`.
- **New (tests):** the 7 unit + 2 integration test files listed in §12.
- **Modified:** `modules/ride/application/{create-ride-request,accept-ride-request,
reject-ride-request,cancel-ride,expire-ride}.ts` (Phase 3.8 wiring),
  `modules/ride/application/ride-lifecycle.ts` and `ride-request-decision.ts`
  (persistence port gains `createNotification`;
  `ride-lifecycle.ts` also gains `findConfirmedParticipantIds`),
  `modules/ride/infrastructure/ride.repository.ts`
  (`findConfirmedParticipantUserIds`), the four ride unit-test files (port
  fakes), the four ride integration-test files (notification cleanup),
  `modules/README.md`.
- **Schema:** none (Phase 2 `Notification` model reused).

## 14. Open decisions left untouched

OD-001…OD-019 remain open, especially:

- **OD-008 (push provider)** stays OPEN. No Firebase/FCM/APNs/Expo, no device
  tokens, no delivery channel was chosen or implemented. The future
  integration point is the repository/application boundary: a delivery
  provider would consume the persisted `Notification` row (id, type, title,
  body, userId) — the content model is already channel-agnostic.
- OD-002 (expiration grace) stays OPEN — `expireRide` behavior unchanged.
- Notification UI, mobile screens, HTTP APIs, auth, WebSocket delivery, request
  cancellation, seat release, and `RIDE_STARTED`/`RIDE_COMPLETED`/
  `REQUEST_CANCELLED` notifications are later phases.

## 15. Assumptions

- `userId`/`recipientId` are trusted application input (no authentication yet);
  authorization will be enforced at the API boundary later.
- Only events whose Ride Engine operations are implemented may produce
  notifications this phase.
- Notification content is centralized and UI-agnostic; exact copy is not a
  product decision.

## 16. Limitations

- No push/device/delivery infrastructure (OD-008 OPEN) — in-app persistent
  rows only.
- No HTTP API to read/write notifications yet (later phase).
- No schema-level idempotency key for notifications (documented in §10).
- No unread-badge push; unread count is available via `listNotifications`.
- Ride cancellation does not cancel requests or release seats (Phase 3.7
  boundary preserved); no `REQUEST_CANCELLED` notification exists.
