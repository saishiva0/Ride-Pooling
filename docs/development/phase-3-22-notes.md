# Phase 3.22 — Realtime Productionization: Implementation Notes

> Status: Phase 3.22 — Implementation in progress
> Date: 2026-08-20
> Resolves: OD-008 (Realtime transport and authentication mechanism)

---

## 1. Objective

Productionize the existing realtime architecture (Phase 3.11) by replacing the fail-closed authentication with the real Phase 3.18 authentication system, implementing proper connection lifecycle, reconnection, duplicate listener protection, and mobile realtime client integration.

---

## 2. Discovery Summary

### A. Existing Socket.io Version

- **Socket.io v4.8.3** (backend dependency)
- **socket.io-client v4.8.3** (backend devDependency for tests)
- Mobile does not yet have socket.io-client (to be added)

### B. Existing Socket.io Server Setup

- `modules/realtime/infrastructure/socket-server.ts` — ONLY place Socket.io is initialized
- `attachSocketServer(httpServer, { logger, authenticator, path, activatePublisher })`
- Auth middleware: `io.use(authenticateSocket)` → joins `user:{userId}` room on success
- Path: `/ws` (per api-boundaries.md)
- Publisher activation: `setEventPublisher(createSocketEventPublisher(io, logger))`

### C. Existing Socket.io Client Dependency Status

- Backend: `socket.io-client` as devDependency (tests only)
- Mobile: **Not yet installed** — needs to be added as dependency

### D. Existing Backend Authenticator

- `HttpAuthenticator` interface (auth.middleware.ts)
- Production: `createBearerTokenAuthenticator(sessionService)` — validates `Authorization: Bearer <token>`
- Test: `createTestAuthenticator()` — reads `x-test-user-id` header
- Fail-closed default: `failClosedAuthenticator` — rejects all
- `server.ts` already uses real bearer authenticator when `SOCKET_ENABLED=true`

### E. Existing Mobile Authenticated-Session Mechanism

- `AuthClient` → `getSession()` restores + validates via `GET /auth/me`
- `AuthHeadersProvider` → `getAuthHeaders()` returns `Authorization: Bearer <token>` from secure storage
- `createStoredAuthHeadersProvider(storage)` — fail-closed, clears on expiry/401
- `AuthProvider` manages auth state: `restoring` | `unauthenticated` | `authenticated` | `authentication-error`

### F. Existing Auth Header Mechanism

- `AuthHeadersProvider.getAuthHeaders()` → `{ Authorization: 'Bearer <token>' } | null`
- API client uses this for all requests
- On 401: `onAuthenticationFailure()` hook clears storage

### G. Existing Realtime Event Contract

- 7 events: `RIDE_REQUESTED`, `REQUEST_ACCEPTED`, `REQUEST_REJECTED`, `REQUEST_CANCELLED`, `RIDE_CANCELLED`, `RIDE_EXPIRED`, `RIDE_CONFIRMED`
- `RealtimeEvent` interface: `eventId`, `type`, `occurredAt`, `rideId`, `requestId`, `recipientUserId`, `data`
- Backend: `modules/realtime/domain/realtime-events.ts`
- Mobile: `src/realtime/events.ts` (mirrors backend exactly)

### H. Existing Room Strategy

- `userRoom(userId) = \`user:${userId}\``
- Joined server-side in `socket-server.ts` after authentication
- No client-controlled room joining

### I. Existing Event Publisher Strategy

- `EventPublisher` interface (event-publisher.ts)
- `noopEventPublisher` default
- `createSocketEventPublisher(io, logger)` — emits to `user:{recipientUserId}` room
- Registry: `setEventPublisher()` / `getEventPublisher()` / `resetEventPublisher()`
- Ride Engine use cases call `publishDrafts(drafts)` **after** transaction commit

### J. Existing Post-Transaction Publishing

- `publishDrafts(drafts)` in `event-publisher.ts`
- Called after `runTransaction` resolves in Ride Engine use cases
- Transaction safety tests verify: commit → publish, rollback → no publish

### K. Existing Mobile Realtime Interface

- `RealtimeClient` port (realtime-client.ts)
- `connectionState`: `disconnected` | `connecting` | `connected` | `disconnecting`
- `connect()`, `disconnect()`, `subscribe(type, handler)` → unsubscribe fn
- Default: `unavailableRealtimeClient` — fail-closed, throws `RealtimeUnavailableError`

### L. Existing Ride/Request/Notification State Handling

- Ride Engine emits domain events → notification drafts → persisted in same transaction
- `publishDrafts()` called after commit → realtime events
- Mobile: `RequestStore` for local request state, `NotificationScreen` fetches from REST

### M. Existing Tests

- Backend: 73 test files, 893 passing, 1 failing (pre-existing Phase 3.21 integration test issue)
- Mobile: 47 test files, 342 passing, 1 failing (pre-existing location-search test issue)
- Realtime integration tests: `realtime.integration.test.ts` (11 tests), `transaction-safety.integration.test.ts` (10 tests)

### N. Existing Environment/Configuration

- Backend: `SOCKET_ENABLED` (optional, defaults false), `MSG91_*`, `SESSION_TTL_DAYS`
- Mobile: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_REALTIME_URL` (optional, defaults null), `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`

### O. Existing Deployment/Scaling Assumptions

- Single-process Socket.io (in-memory adapter)
- Horizontal scaling = post-V1 (Redis adapter documented, not implemented)
- No message broker in V1

---

## 3. OD-008 Resolution

Resolved in `docs/planning/open-decisions.md` and `docs/planning/phases/phase-3-22.md`.

**Key decisions:**

- Transport: Socket.io (preserved)
- Auth: Phase 3.18 bearer token via handshake headers
- Identity: Server-derived only
- Rooms: `user:{userId}` (server-controlled)
- Reconnection: Bounded backoff for transient failures; no retry on auth failure
- Delivery: Best-effort, REST authoritative
- Scaling: Single-process V1

---

## 4. Architecture

### Backend (Preserved + Enhanced)

```
modules/realtime/
  domain/realtime-events.ts           — UNCHANGED (7 events, contract)
  application/event-mapping.ts        — UNCHANGED (draft → event)
  application/event-publisher.ts      — UNCHANGED (publisher abstraction)
  infrastructure/rooms.ts             — UNCHANGED (user:{userId})
  infrastructure/socket-auth.ts       — UNCHANGED (authenticateSocket via HttpAuthenticator)
  infrastructure/socket-publisher.ts  — UNCHANGED (Socket.io publisher)
  infrastructure/socket-server.ts     — ENHANCED (connection lifecycle logging)
```

### Mobile (New Implementation)

```
src/realtime/
  events.ts                   — UNCHANGED (mirrors backend)
  realtime-client.ts          — UNCHANGED (port interface)
  socket-client.ts            — NEW (concrete Socket.io implementation)
  realtime-client.test.ts     — EXISTING (fail-closed tests)
  socket-client.test.ts       — NEW (concrete client tests)
  events.test.ts              — EXISTING (contract tests)
```

---

## 5. Authentication Integration

### Backend (Already Complete)

`server.ts` lines 43-48:

```typescript
if (config.SOCKET_ENABLED) {
  const authDeps = createDefaultAuthDependencies(config);
  attachSocketServer(server, {
    logger,
    authenticator: createBearerTokenAuthenticator(authDeps.sessionService),
  });
}
```

The `authenticateSocket` function passes socket handshake headers to the `HttpAuthenticator`, which validates the bearer token via the session service. No changes needed.

### Mobile (To Implement)

- `SocketRealtimeClient` reads token from `AuthHeadersProvider.getAuthHeaders()`
- Passes `Authorization: Bearer <token>` in `extraHeaders` to `socket.io-client`
- On connect_error with authentication failure: disconnect, surface error
- `AuthProvider` manages client lifecycle with auth state

---

## 6. Room Strategy

**Unchanged:** `user:{userId}` — server-controlled join after authentication.

---

## 7. Connection Lifecycle

### Backend Logging Enhancement

Add structured logging for:

- `socket.authenticated` — successful auth, room joined
- `socket.disconnected` — reason, userId
- `socket.reconnecting` — attempt number
- `socket.reconnected` — success
- `socket.error` — transport errors (no secrets)

### Mobile Connection State

Extend `RealtimeConnectionState`:

```
'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'
```

Socket.io events map to:

- `connect` → `connected`
- `disconnect` → `disconnected` (or `reconnecting` if `io.engine.reconnecting`)
- `connect_error` → `error` (if auth) or `reconnecting`
- `reconnect` → `connected`
- `reconnect_attempt` → `reconnecting`
- `reconnect_failed` → `error`

---

## 8. Reconnection Behavior

### Socket.io Configuration (Mobile)

```typescript
const socket = io(realtimeUrl, {
  path: '/ws',
  extraHeaders: { Authorization: `Bearer ${token}` },
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  randomizationFactor: 0.5,
  timeout: 10000,
  autoConnect: false,
});
```

### Auth Failure Handling

- `connect_error` with authentication error → **no reconnect**, set state `error`, surface to app
- App clears session, navigates to auth boundary

### Transient Failure Handling

- Network errors → Socket.io handles reconnection with backoff
- On successful reconnect → re-join room (automatic), restore subscriptions

---

## 9. Event Semantics

**Preserved exactly:** 7 events, minimal payloads, server-determined recipients.

---

## 10. Persistence Relationship

**Unchanged:** Database notifications authoritative. Realtime = best-effort delivery.

Mobile recovery: `GET /api/v1/notifications` after reconnect.

---

## 11. Scaling

V1: Single-process, in-memory adapter. Documented for post-V1: Socket.io Redis adapter.

---

## 12. Security

- Fail-closed auth (no token → reject)
- Server-derived identity only
- No caller-controlled recipient/room
- Minimal payloads
- No secrets in logs
- Connection errors normalized
- Auth spoofing tested

---

## 13. Mobile Integration

### AuthProvider Lifecycle Management

```typescript
// In AuthProvider
useEffect(() => {
  if (state.status === 'authenticated') {
    realtimeClient.connect();
  } else {
    realtimeClient.disconnect();
  }
}, [state.status, realtimeClient]);
```

### Screen Subscriptions

- Components use `realtimeClient.subscribe()` in `useEffect` with cleanup
- `NotificationsScreen` refreshes from REST on realtime event
- `MyRequestsScreen` updates local state on `REQUEST_ACCEPTED`/`REJECTED`/`CANCELLED`

---

## 14. Backend Integration

Already complete via `server.ts`. Only enhancement: connection lifecycle logging.

---

## 15. Tests

### Backend (New Tests)

- Real bearer token authentication (not test authenticator)
- Auth failure modes
- Room isolation
- Auth spoofing
- Connection lifecycle
- Reconnection

### Mobile (New Tests)

- Authenticated connection
- Connection state machine
- Reconnection
- Subscription management
- Duplicate prevention
- Session changes
- Event handling

---

## 16. Quality Gates

All existing gates must pass + new tests.

---

## 17. Limitations (V1)

- Single-process only
- Best-effort delivery
- No presence/typing/location streaming
- No push (Phase 3.23)
- No chat (Phase 3.25)
- No outbox/replay
- No broker

---

## 18. Assumptions

- Phase 3.18 authentication is stable and tested
- `SOCKET_ENABLED=true` in development for testing
- PostgreSQL available at `localhost:5433` for integration tests
- Expo development build for mobile testing

---

## 19. Out of Scope

See §17 and phase spec.

---

## 20. Final Verification (To Be Completed)

- [ ] OD-008 documented
- [ ] Phase spec created
- [ ] Backend logging enhanced
- [ ] Mobile socket-client implemented
- [ ] Mobile AuthProvider integration
- [ ] Screen subscriptions added
- [ ] Backend tests pass
- [ ] Mobile tests pass
- [ ] Quality gates green
- [ ] Live verification passes
- [ ] Phase notes completed
