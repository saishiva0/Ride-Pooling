# Phase 3.11 — Real-Time Ride Updates: Implementation Notes

> Status: Phase 3.11 — Implementation
> Records how a real-time delivery layer (Socket.io) was added on top of the
> existing Ride Engine, notification, auth, and HTTP boundaries. REST remains
> the authoritative API; realtime is an additional, best-effort delivery
> mechanism that fires only AFTER the database transaction commits. No schema,
> migration, or seed changes. **OD-005 (authentication method) and OD-008
> (real-time communication details) remain OPEN** — no real authentication, no
> broker, no outbox, no push provider, no scheduler.

## 1. Purpose and boundary

Realtime complements the Phase 3.8 persistent notifications:

```
Application Service → Database Transaction → Commit → EventPublisher → Socket.io → Authenticated Client
```

- Persistent database state stays authoritative. A client that is offline
  still retrieves every notification through `GET /api/v1/notifications`.
- An event is **never** emitted before the transaction commits, and never
  inside the transaction.
- Delivery is best-effort: an emission failure never fails the committed
  operation (it is caught and logged).

## 2. Architecture

```
modules/realtime/
  domain/realtime-events.ts        RealtimeEvent contract + the six supported types
  application/event-mapping.ts     NotificationDraft → RealtimeEvent mapping
  application/event-publisher.ts   EventPublisher interface + registry (no-op default)
  infrastructure/rooms.ts          user:{userId} room naming
  infrastructure/socket-auth.ts    socket auth via the shared HttpAuthenticator
  infrastructure/socket-publisher.ts  Socket.io EventPublisher implementation
  infrastructure/socket-server.ts  Socket.io initialization (ONLY place Socket.io lives)
```

**Dependency rule:** the realtime domain and application layers never import
Socket.io types. Socket.io exists only in `infrastructure/` and the HTTP
boundary (`server.ts`). Application services depend only on the
framework-independent `EventPublisher` abstraction (via the `publishEvents`
dependency, defaulting to `publishDrafts`).

## 3. Event contracts

Six events, matching the Phase 3.8 notification types exactly — no product
events are invented:

`RIDE_REQUESTED`, `REQUEST_ACCEPTED`, `REQUEST_REJECTED`, `RIDE_CANCELLED`,
`RIDE_EXPIRED`, `RIDE_CONFIRMED`.

```ts
interface RealtimeEvent {
  eventId: string; // unique per emit; client-side identification only (not persisted)
  type: RealtimeEventType; // one of the six
  occurredAt: string; // ISO-8601 UTC
  rideId: string | null;
  requestId: string | null;
  recipientUserId: string; // the single recipient (server-determined)
  data: Record<string, unknown>; // minimal: title/body — never DB records, credentials, or private locations
}
```

Event ids use `randomUUID` (injectable for deterministic tests). Timestamps are
a single ISO-8601 UTC value per batch.

## 4. Recipient mapping

`toRealtimeEvents()` derives realtime events from the **same notification
drafts** the Ride Engine persists (Phase 3.8 `notification-mapping.ts`), which
remains the authoritative recipient definition — the two models cannot
diverge.

| Event            | Recipient                                                               |
| ---------------- | ----------------------------------------------------------------------- |
| RIDE_REQUESTED   | ride creator                                                            |
| REQUEST_ACCEPTED | requester                                                               |
| REQUEST_REJECTED | requester                                                               |
| RIDE_CANCELLED   | creator + confirmed participants                                        |
| RIDE_EXPIRED     | creator + confirmed participants                                        |
| RIDE_CONFIRMED   | creator + confirmed requester (first acceptance: PUBLISHED → CONFIRMED) |

## 5. Socket authentication

Socket identity comes from the **same** `HttpAuthenticator` the REST boundary
uses (Phase 3.10) — there is no separate Socket.io authentication mechanism.

- Production: **fail-closed**. `server.ts` attaches the socket server (when
  `SOCKET_ENABLED=true`) with `failClosedAuthenticator`, so every socket is
  rejected while OD-005 is open.
- Tests only: the explicit `createTestAuthenticator()` (`x-test-user-id`
  handshake header) is injected by the integration suite — the same seam the
  HTTP tests use.
- `socket.handshake.auth.userId` or any caller-supplied identity is **never**
  trusted. The header is only input to the authenticator, which is the sole
  authority.

## 6. Room strategy

Private, server-controlled rooms: `user:{userId}`. After authentication the
socket joins its own room; events are emitted only to the recipient's room. A
client can never join another user's room, and a `userId` is never accepted
from the client as proof of identity.

Note: Socket.io v4's in-memory adapter joins rooms synchronously (clustered
adapters return a Promise — the server awaits the promise when present so a
publish cannot race room membership).

## 7. Transaction → commit → publish

The five ride use cases take an injectable `publishEvents` dependency
(defaulting to `publishDrafts`):

- `createRideRequest`, `acceptRideRequest`, `rejectRideRequest`
  (shared via `ride-request-decision.ts`)
- `cancelRide`, `expireRide` (shared via `ride-lifecycle.ts`)

Each awaits the `runTransaction` first and calls
`await publishEvents?.(outcome.drafts)` **after** it resolves. If the
transaction fails or rolls back, the publish step is never reached → **no
event**. No outbox table exists; the post-transaction adapter is the smallest
change that guarantees commit-then-publish for this phase (documented decision,
see §12).

## 8. Failure behavior

- **Transaction failure/rollback:** no event (the publish call is skipped).
- **Delivery failure:** caught and logged by the Socket.io publisher; the
  already-committed operation is never failed. Persistent notifications remain
  the source of truth.
- **Socket authentication failure:** safe error only (the `io.use` middleware
  rejects with `Authentication failed`); internal errors, Prisma errors, stack
  traces, and secrets are never sent to clients.

## 9. Security model

- Unauthenticated socket → rejected; malformed identity → rejected
  (fail-closed).
- Authenticated socket → joined only to `user:{ownUserId}`.
- Recipient is determined server-side from the notification draft; no
  caller-controlled recipient.
- Payloads are minimal and never contain Prisma records, credentials,
  password hashes, database errors, or private location data.
- Socket.io exists only at the infrastructure/HTTP boundary; domain and
  application layers depend only on the `EventPublisher` abstraction.
- No secrets in logs; the existing logger is reused.

## 10. Testing approach

Unit tests (contract, mapping, publisher registry, socket auth) plus two
integration suites:

1. **Transaction safety** (`realtime/application/transaction-safety.integration.test.ts`)
   — real PostgreSQL, capturing publisher: committed operations publish;
   failed/rolled-back operations publish nothing; a conflict operation
   publishes nothing.
2. **Real Socket.io** (`realtime/realtime.integration.test.ts`) — real Express
   app + PostgreSQL + Socket.io on ephemeral ports: authenticated connection
   succeeds; unauthenticated/malformed connections fail; the fail-closed
   default rejects every socket; a user receives only their own events (room
   isolation); all six event types reach the authoritative recipients; payload
   minimality (no Prisma records/secrets); offline recipients still retrieve
   notifications through REST.

Deterministic synchronization: listeners are registered **before** the
triggering operation (the publisher emits after commit but before the HTTP
response is sent, so a listener attached after the request would race the
packet). Bounded timeouts only — no arbitrary sleeps. Tests clean up sockets,
servers, and database fixtures.

## 11. Wiring / configuration

- `server.ts` attaches `attachSocketServer(server, { logger, authenticator:
failClosedAuthenticator })` when `config.SOCKET_ENABLED` is true. The socket
  path is `/ws` (`docs/architecture/api-boundaries.md`).
- `SOCKET_ENABLED` is an optional env var (defaults to **false**) — a
  reserved placeholder from the Phase 3.10 env schema; realtime is off unless
  explicitly enabled, and even then production sockets fail closed while
  OD-005 is open.
- `socket.io` added as a backend dependency, `socket.io-client` as a dev
  dependency (both pinned by pnpm-lock.yaml).

## 12. Why no broker / no outbox

- **No message broker (Kafka/RabbitMQ/Redis):** a single-process Socket.io
  deployment is sufficient for the current architecture; the `EventPublisher`
  abstraction is the seam where a broker could be introduced later without
  touching the domain/application layers.
- **No outbox table:** the use cases already structure the work as a single
  transaction followed by a publish call; the smallest correct adapter is the
  post-transaction `publishEvents` call, so an outbox would add persistence
  machinery with no current requirement. Documented decision; revisit if
  delivery guarantees become a product requirement.

## 13. Open decisions

- **OD-005 (authentication method): OPEN.** No passwords, JWT, OAuth,
  sessions, refresh tokens, OTP, or verification implemented. All sockets fail
  closed in production until the approved mechanism lands and a real
  authenticator is injected.
- **OD-008 (real-time communication details): OPEN.** Transport choice
  (Socket.io remains the ADR-010 planned stack), presence, and delivery
  guarantees are product decisions not resolved here.

## 14. Limitations

- No real authentication — every production socket is rejected while OD-005
  is open.
- Delivery is best-effort: events are not persisted, not replayed, and not
  acknowledged (no outbox, no broker).
- Only the six Ride Engine events exist; no chat, presence, typing, location
  streaming, or other realtime features (explicitly out of scope).
- Realtime is disabled by default (`SOCKET_ENABLED=false`).
- A single-process Socket.io deployment; no horizontal scaling or sticky
  sessions.

## 15. Phase boundary

**Phase 3.12 and later phases were NOT started.** No push notifications
(Firebase/FCM/APNs/Expo), no scheduled expiration jobs, no mobile UI, no
outbox/event store, no broker, no microservices. REST remains the
authoritative API; realtime is an additional delivery mechanism.
