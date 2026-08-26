# Notification Module

Layered structure, matching the Ride Engine's domain / application /
infrastructure split (Phase 3.8):

```
notification/
  domain/           pure, deterministic type catalogue (notification-rules.ts)
  application/      use cases + content + event→notification mapping
  infrastructure/   Prisma persistence (notification.repository.ts)
```

## What this module is

The **persistent, in-app notification foundation**. Ride Engine operations
(request created/accepted/rejected, ride cancelled/expired/confirmed) write a
`Notification` row — inside the **same transaction** as the state change, so a
notification is durable exactly when the operation that produced it succeeds,
and rolls back with it otherwise. See `docs/development/phase-3-8-notes.md` for
the full design.

## Application services

- `createNotification(input, deps?)` — standalone create (validates recipient
  - type, defaults content from the centralized mapping, returns
    `AppNotification`). Ride Engine operations do NOT use this service; they
    write notifications through their own persistence ports inside their own
    transactions via the mapping layer.
- `listNotifications({ userId, limit? })` — a recipient's notifications,
  newest first, with an unread count and `hasMore` (deterministic `createdAt
DESC, id DESC`; no cursor pagination — the architecture has none).
- `markNotificationAsRead({ notificationId, userId })` — owner-only read
  update; already-read notifications are idempotent (no write).
- `markAllNotificationsAsRead({ userId })` — one efficient update of the
  recipient's unread notifications; returns `{ updatedCount }`.

## Supporting layers

- `domain/notification-rules.ts` — `SUPPORTED_NOTIFICATION_TYPES` (the six
  wired Ride Engine events), `isNotificationType`, `isSupportedNotificationType`.
- `application/notification-content.ts` — the single source of `title`/`body`
  for each type; throws `ValidationError` for unwired types.
- `application/notification-mapping.ts` — the only place that knows who
  receives what (draft builders + `persistNotificationDrafts`).
- `application/notification-dependencies.ts` — the Prisma-free persistence
  port (`NotificationPersistence`) and default transaction wiring.
- `infrastructure/notification.repository.ts` — the only Prisma access
  (create, find by id, list, count unread, mark read / all read,
  recipient lookup, error classification). No business rules.

## Conventions

- Application results are typed (`AppNotification`); raw Prisma records never
  cross the application boundary.
- Raw Prisma errors never escape: P2003 → `NotFoundError`, everything else →
  `InternalError`.
- `userId`/`recipientId` are trusted input (authentication is a later phase);
  authorization will be enforced at the API boundary. Ownership is already
  enforced for read-state updates (one user can never mark another user's
  notification read).

## Non-goals (later phases)

Push delivery (Firebase/FCM/APNs/Expo), device tokens, SMS/email, WebSocket
delivery, notification UI/mobile screens, HTTP APIs, authentication. OD-008
(push provider) stays OPEN.
