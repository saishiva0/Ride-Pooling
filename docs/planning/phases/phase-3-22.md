# Phase 3.22 — Realtime Productionization

> Status: **APPROVED — Implementation in progress**
> Predecessor: Phase 3.21 (complete). Depends on OD-005 (resolved Phase 3.18) and OD-008 (resolved in this phase).

---

## 0. Status

**APPROVED** — Implementation authorized. Phase 3.21 is complete. OD-005 (authentication: phone + OTP via MSG91) is resolved. OD-008 (realtime transport and authentication) is resolved in this phase.

---

## 1. Objective

Productionize the existing realtime architecture (Phase 3.11) by replacing the fail-closed authentication with the real Phase 3.18 authentication system, implementing proper connection lifecycle, reconnection, duplicate listener protection, and mobile realtime client integration — all while preserving existing event contracts, room strategy, and post-commit publishing guarantees.

---

## 2. Scope

**In scope:**

- Backend: Real socket authentication using Phase 3.18 bearer token authenticator
- Backend: Connection lifecycle handling (connect, disconnect, reconnect, errors)
- Backend: Structured logging (no secrets)
- Mobile: Concrete `RealtimeClient` implementation using `socket.io-client`
- Mobile: Authenticated connection using stored bearer token
- Mobile: Connection state management (`disconnected` | `connecting` | `connected` | `reconnecting` | `error`)
- Mobile: Subscription management (no duplicate listeners, proper cleanup)
- Mobile: Session change handling (sign out → disconnect, sign in → reconnect)
- Tests: Backend authenticated socket, room isolation, auth spoofing, reconnection, transaction safety
- Tests: Mobile authenticated connection, reconnection, duplicate subscription prevention, session changes
- Documentation: OD-008 resolution, phase notes, updated READMEs

**Out of scope (explicit):**

- Push notifications (Phase 3.23)
- Chat/messages (Phase 3.25)
- Payments (Phase 3.26)
- Outbox/event store (not required by V1)
- Message broker (Redis/Kafka/etc.) — single-process V1
- Multi-instance scaling
- Event replay/replay protocol
- New ride states, matching rules, cancellation policies
- New product features

---

## 3. Dependencies

- Phase 3.11: Realtime foundation (event contracts, publisher, rooms, socket server)
- Phase 3.18: Phone + OTP authentication, bearer sessions, `HttpAuthenticator`
- Phase 3.19: Matching (OD-004 resolved)
- Phase 3.20: Maps (OD-007 resolved)
- Phase 3.21: Request cancellation, `REQUEST_CANCELLED` event

---

## 4. Existing Architecture (Phase 3.11 Baseline)

### Realtime Module Structure

```
modules/realtime/
  domain/realtime-events.ts           — 7 event types, RealtimeEvent contract
  application/event-mapping.ts        — NotificationDraft → RealtimeEvent
  application/event-publisher.ts      — EventPublisher interface + registry
  infrastructure/rooms.ts             — user:{userId} room naming
  infrastructure/socket-auth.ts       — authenticateSocket via HttpAuthenticator
  infrastructure/socket-publisher.ts  — Socket.io EventPublisher impl
  infrastructure/socket-server.ts     — Socket.io init (ONLY place Socket.io lives)
```

### Event Contract (7 events)

`RIDE_REQUESTED`, `REQUEST_ACCEPTED`, `REQUEST_REJECTED`, `REQUEST_CANCELLED`, `RIDE_CANCELLED`, `RIDE_EXPIRED`, `RIDE_CONFIRMED`

### Room Strategy

Private `user:{userId}` rooms. Server-controlled join from authenticated identity only.

### Publisher

`EventPublisher` abstraction. Default `noopEventPublisher`. Socket server activates `createSocketEventPublisher(io, logger)` on init. Ride Engine use cases call `publishDrafts(drafts)` **after** transaction commit.

### Transaction Rule

```
DB Transaction → Commit → publishDrafts() → Socket.io emit
```

Rollback = no event. Never publish inside transaction.

### Current Auth (Phase 3.11)

`server.ts` attaches socket server with `failClosedAuthenticator` when `SOCKET_ENABLED=true`. Phase 3.18 changed this to use `createBearerTokenAuthenticator(authDeps.sessionService)` — but tests still use `createTestAuthenticator()`.

---

## 5. OD-008 Decision (Resolved in This Phase)

See `docs/planning/open-decisions.md` for the full decision record.

**Summary:**

- Transport: Socket.io (preserved from Phase 3.11)
- Auth: Phase 3.18 bearer token via `Authorization` header on handshake
- Identity: Server-derived from token validation only
- Rooms: `user:{userId}` (server-controlled)
- Lifecycle: connect → auth → join; disconnect → leave
- Reconnection: Bounded backoff for transient failures; no retry on auth failure
- Events: 7 types, minimal payloads, post-commit
- Delivery: Best-effort, REST authoritative
- Scaling: Single-process V1; Redis adapter post-V1

---

## 6. Backend Changes

### 6.1 Socket Authentication (Already Integrated)

`server.ts` already uses `createBearerTokenAuthenticator(authDeps.sessionService)` when `SOCKET_ENABLED=true`. The `authenticateSocket` function in `socket-auth.ts` passes handshake headers to the `HttpAuthenticator`. **No code change needed** — the integration is complete.

### 6.2 Connection Lifecycle Logging

Enhance `socket-server.ts` to log:

- Successful authentication + room join
- Disconnect (with reason)
- Reconnect attempts
- Transport errors

All logs must exclude credentials, tokens, OTP, and PII.

### 6.3 Room Join Await

Already handled: `socket.join(room)` returns a Promise with clustered adapters; the code awaits it.

### 6.4 Tests to Add/Modify

- Authenticated socket connection (real bearer token)
- Missing/malformed/invalid authentication → rejection
- User room isolation (User A cannot receive User B's events)
- Arbitrary room join rejection
- Connection/disconnect/reconnect behavior
- All 7 event types delivered to correct recipients
- Payload security (no Prisma records, no secrets)
- Post-commit publishing (already tested in `transaction-safety.integration.test.ts`)
- Rollback → no event (already tested)
- Auth spoofing: client sends `userId=UserB` but token is UserA → joins `user:UserA`

---

## 7. Mobile Changes

### 7.1 Concrete Realtime Client

New file: `src/realtime/socket-client.ts` implementing `RealtimeClient` using `socket.io-client`.

**Requirements:**

1. Connect using `realtimeUrl` from config + `Authorization: Bearer <token>` from `AuthHeadersProvider`
2. Track connection state: `disconnected` | `connecting` | `connected` | `reconnecting` | `error`
3. Expose `connectionState` readonly
4. `subscribe(type, handler)` → returns unsubscribe function
5. `unsubscribe` cleanup on component unmount / sign out
6. Reconnection: Socket.io built-in with bounded backoff
7. Prevent duplicate listeners for same event type
8. On auth failure (401/token invalid): disconnect, clear session, surface error
9. On sign out: disconnect, clear all subscriptions
10. On sign in: new connection with new token

### 7.2 Realtime Client Integration

- `createDefaultAuthDependencies()` creates the concrete client
- `AuthProvider` manages realtime connection lifecycle with auth state
- Sign out → `realtimeClient.disconnect()`
- Sign in → `realtimeClient.connect()`
- Session invalid → disconnect + clear

### 7.3 Screen Integration

Subscribe to events where they materially improve UX:

- Ride requests screen: `RIDE_REQUESTED` (creator)
- My requests screen: `REQUEST_ACCEPTED`, `REQUEST_REJECTED`, `REQUEST_CANCELLED`
- Notifications screen: all events → refresh from REST
- Active ride: `RIDE_CANCELLED`, `RIDE_CONFIRMED`

### 7.4 Event Validation

Validate incoming event shape at transport boundary. Malformed events → safe ignore/error normalization. Never crash on malformed payload.

### 7.5 Tests to Add

- Authenticated connection with real token
- Unauthenticated behavior (fail closed)
- Connection state transitions
- Reconnect after transient failure
- Subscription + unsubscribe lifecycle
- Duplicate subscription prevention
- Sign out → disconnect + cleanup
- Sign in → new connection
- Session invalid → proper error handling
- All 7 event types handled correctly
- Safe error normalization

---

## 8. Event Model

**Preserved from Phase 3.11/3.21:** 7 event types, minimal payloads, server-determined recipients.

**Recipient Mapping (unchanged):**

| Event             | Recipient                                    |
| ----------------- | -------------------------------------------- |
| RIDE_REQUESTED    | Ride creator                                 |
| REQUEST_ACCEPTED  | Requester                                    |
| REQUEST_REJECTED  | Requester                                    |
| REQUEST_CANCELLED | Ride creator                                 |
| RIDE_CANCELLED    | Creator + confirmed participants             |
| RIDE_EXPIRED      | Creator + confirmed participants             |
| RIDE_CONFIRMED    | Creator + confirmed requester (first accept) |

**No contract changes.**

---

## 9. Authentication

Backend: `HttpAuthenticator` (bearer token) validates socket handshake headers.

Mobile: `AuthHeadersProvider` provides `Authorization: Bearer <token>` from secure storage. Socket.io client passes this in `extraHeaders` on connection.

**Never trust:** `socket.handshake.auth.userId`, query params, or client-supplied room IDs.

---

## 10. Rooms

`user:{userId}` — joined server-side after successful authentication. No client API to join arbitrary rooms.

---

## 11. Connection Lifecycle

```
disconnected
    │
    ▼ (connect with token)
connecting ──auth ok──▶ connected ──disconnect──▶ disconnected
    │              │
    │              ▼
    │           reconnecting ──auth ok──▶ connected
    │              │
    │              ▼
    │           error (auth failure) ──▶ disconnected
    │
    ▼ (auth fail)
error ──▶ disconnected
```

---

## 12. Reconnection

- Socket.io built-in reconnection with `reconnectionAttempts`, `reconnectionDelay`, `reconnectionDelayMax`
- Transient network failures: reconnect automatically
- Authentication failure (token expired/revoked): **no reconnect**, surface error, app handles sign-out
- On successful reconnect: re-join room, restore subscriptions
- **Do not fabricate missed events** — REST is the recovery mechanism

---

## 13. Persistence

Database notifications remain authoritative. Realtime is best-effort delivery only.

Client recovery: `GET /api/v1/notifications` after reconnect.

No outbox, no replay in V1.

---

## 14. Security

- Fail-closed auth (Phase 3.18)
- Server-derived identity only
- No caller-controlled recipient/room
- Minimal payloads (no Prisma records, tokens, OTP, phone, internal IDs)
- Structured logs without secrets
- Connection errors normalized (no stack traces to client)
- Auth spoofing prevented (tested)

---

## 15. Testing

### Backend (add to existing suite)

1. Authenticated socket connection (real token)
2. Missing authentication → reject
3. Malformed authentication → reject
4. Invalid authentication → reject
5. Identity derived from token only
6. User room isolation (A≠B)
7. Arbitrary room join rejected
8. Connection/disconnect lifecycle
9. Reconnect behavior
10. Event mapping correctness
11. Payload security
12. Post-commit publish
13. Rollback → no publish
14. All 7 events: correct producer, recipient, room, payload

### Mobile (add to existing suite)

1. Authenticated realtime connection
2. Unauthenticated behavior
3. Connection state tracking
4. Reconnect after transient failure
5. Disconnect cleanup
6. Subscription management
7. Unsubscribe cleanup
8. Duplicate subscription prevention
9. Session change (sign out → disconnect, sign in → connect)
10. Event mapping
11. Event handling
12. Safe error normalization
13. REQUEST_CANCELLED handling
14. All 7 ride lifecycle events

### Security Tests (explicit)

- User A cannot receive User B's event
- Client cannot specify another userId
- Client cannot join another user's room
- Client cannot spoof authentication identity
- Creator-only events not received by requester (and vice versa)

---

## 16. Quality Gates

All must pass:

- Backend: `typecheck`, `lint`, `test`, `build`
- Mobile: `typecheck`, `lint`, `test`
- Repository: `format:check`
- Database: `prisma validate`, `prisma migrate status`, `db:check`
- Expo: `expo config --type public`
- Health endpoint: `GET /health` → 200
- Live verification: authenticated socket connects, events delivered, isolation verified

---

## 17. Out of Scope (Reiterated)

- Push notifications (Phase 3.23)
- Chat (Phase 3.25)
- Payments (Phase 3.26)
- Offline sync engine (Phase 3.27)
- Admin/analytics/observability (Phase 3.28+)
- Message broker/outbox
- Multi-instance scaling
- New product features

---

## 18. Limitations (V1)

- Single-process Socket.io only
- Best-effort delivery (no exactly-once)
- No presence, typing indicators, location streaming
- No event replay
- In-memory rate limiting for OTP (Phase 3.18 limitation)
- No horizontal scaling

---

## 19. Acceptance Criteria

- [ ] OD-008 resolved and documented in `open-decisions.md`
- [ ] Phase spec created at `docs/planning/phases/phase-3-22.md`
- [ ] Backend socket authentication uses real Phase 3.18 bearer tokens
- [ ] Server-derived identity only (no client-supplied userId)
- [ ] User rooms server-controlled (`user:{userId}`)
- [ ] User room isolation tested (A≠B)
- [ ] Auth spoofing prevented (tested)
- [ ] Connection lifecycle implemented with structured logging
- [ ] Reconnection implemented (bounded backoff, no auth retry)
- [ ] Duplicate listener prevention implemented
- [ ] Sign-out disconnects realtime
- [ ] Session changes handled safely (no cross-session leaks)
- [ ] All 7 event contracts preserved
- [ ] REQUEST_CANCELLED supported
- [ ] Post-commit publishing preserved
- [ ] Rollback → no event
- [ ] REST remains authoritative fallback
- [ ] Mobile concrete `RealtimeClient` implemented
- [ ] Backend realtime integration complete
- [ ] Backend tests pass (including new tests)
- [ ] Mobile tests pass (including new tests)
- [ ] Typecheck passes (backend + mobile)
- [ ] Lint passes (backend + mobile)
- [ ] Build passes (backend)
- [ ] Format check passes
- [ ] Prisma validation passes
- [ ] Prisma migrate status clean
- [ ] Database check passes
- [ ] Expo config resolves
- [ ] Health endpoint returns 200
- [ ] Live realtime verification passes
- [ ] No Phase 3.23+ work implemented
