# Realtime module (Phase 3.11)

Real-time delivery of Ride Engine / notification events over Socket.io,
**after** the database transaction has committed. REST remains the
authoritative API; realtime is an additional delivery mechanism for connected,
authenticated clients. An offline client still retrieves everything through
`GET /api/v1/notifications` (Phase 3.8 persistence stays authoritative).

## Layout

```
realtime/
  domain/realtime-events.ts        event contract (framework-independent types)
  application/event-mapping.ts     draft → realtime event mapping
  application/event-publisher.ts   EventPublisher abstraction + registry (no-op default)
  infrastructure/rooms.ts          private user room naming (user:{userId})
  infrastructure/socket-auth.ts    socket authentication via the shared HttpAuthenticator
  infrastructure/socket-publisher.ts  Socket.io EventPublisher implementation
  infrastructure/socket-server.ts  Socket.io initialization (the ONLY place it lives)
```

**Dependency rule:** the domain and application layers never import Socket.io
types. Socket.io exists only in `infrastructure/` and the HTTP boundary.

## Event contract

Six events, matching the Phase 3.8 notification types exactly (no product
events invented):

`RIDE_REQUESTED`, `REQUEST_ACCEPTED`, `REQUEST_REJECTED`, `RIDE_CANCELLED`,
`RIDE_EXPIRED`, `RIDE_CONFIRMED`.

Each event is a `RealtimeEvent`: `eventId` (unique per emit, client-side
identification only, not persisted), `type`, `occurredAt` (ISO-8601 UTC),
`rideId` / `requestId` where applicable, `recipientUserId` (the single
recipient), and a minimal `data` payload (title/body — nothing sensitive, no
Prisma records, no credentials, no private location data).

## Recipient mapping

The Phase 3.8 notification mapping (`notification/application/notification-mapping.ts`)
is the **authoritative** recipient definition. `toRealtimeEvents()` derives the
realtime events from the _same drafts_ the Ride Engine persists, so the two
recipient models can never diverge:

| Event            | Recipient                                                               |
| ---------------- | ----------------------------------------------------------------------- |
| RIDE_REQUESTED   | ride creator                                                            |
| REQUEST_ACCEPTED | requester                                                               |
| REQUEST_REJECTED | requester                                                               |
| RIDE_CANCELLED   | creator + confirmed participants                                        |
| RIDE_EXPIRED     | creator + confirmed participants                                        |
| RIDE_CONFIRMED   | creator + confirmed requester (first acceptance, PUBLISHED → CONFIRMED) |

## Transaction → commit → publish

The five Ride Engine use cases (create ride request, accept, reject, cancel,
expire) await the database transaction **first** and call
`publishDrafts(drafts)` **only after** it commits — never from inside the
transaction. A failed or rolled-back transaction therefore emits nothing. This
is implemented as a small post-commit adapter inside the use cases'
`deps.publishEvents` default wiring (`ride/application/ride-request-decision.ts`,
`ride-lifecycle.ts`); controllers and domain logic are untouched.

Delivery is **best-effort**: a Socket.io emission failure is caught and logged
and never fails the already-committed operation (the persistent notification
remains authoritative).

## Authentication

Socket identity comes from the **same** `HttpAuthenticator` the REST boundary
uses (Phase 3.10). There is no separate Socket.io authentication mechanism.

- Production default (Phase 3.18, OD-005 resolved): the real bearer-token
  authenticator over the session service — a connection is accepted only with
  a valid `Authorization: Bearer <token>` (see
  `modules/auth/http/bearer-authenticator.ts`).
- Tests: the explicit `createTestAuthenticator()` (`x-test-user-id` handshake
  header) is injected by the integration suite.
- A caller-supplied `userId` (e.g. `socket.handshake.auth.userId`) is **never**
  trusted as identity; the header is only input to the authenticator.

## Rooms

Private, server-controlled rooms: `user:{userId}`, joined only from the
authenticated identity. A client can never join another user's room, and
events are emitted only to the recipient's room.

## Wiring

`server.ts` attaches the Socket.io server when `SOCKET_ENABLED=true`
(default **false** — the reserved Phase 3.10 placeholder; realtime is off
unless explicitly enabled). Socket.io path: `/ws` (see
`docs/architecture/api-boundaries.md`).

## Testing

- Unit: event contract, draft→event mapping, publisher registry, socket auth.
- Integration (real Express + PostgreSQL + Socket.io on ephemeral ports):
  connection accept/reject/fail-closed, room isolation, all six events
  delivered to the correct recipients, payload minimality, offline users still
  retrieving notifications through REST, and transaction safety (committed
  operations publish; failed/rolled-back operations publish nothing).

See `docs/development/phase-3-11-notes.md`.
