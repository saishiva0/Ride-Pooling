/**
 /**
 * Socket authentication (Phase 3.11; Phase 3.18 — OD-005 resolved).
 *
 * The socket identity comes from the SAME authentication abstraction as the
 * REST boundary (`HttpAuthenticator` from Phase 3.10) — there is no separate
 * Socket.io authentication mechanism. The handshake headers are passed to the
 * authenticator, which decides. Since Phase 3.18 the production authenticator
 * is the real bearer-token authenticator over the session service; the
 * fail-closed authenticator remains the explicit default for tests, and the
 * test/development authenticator is injected only by the integration suite.
 *
 * Never trusts `socket.handshake.auth.userId` or any caller-supplied
 * identity: the header is just input to the authenticator, which remains the
 * only authority.
 */
import type { Request } from 'express';
import type { Socket } from 'socket.io';
import type { AuthenticatedUser } from '../../auth/domain/identity.js';
import type { HttpAuthenticator } from '../../auth/http/auth.middleware.js';

/**
 * Resolves the authenticated user for a socket using the same
 * `HttpAuthenticator` the API boundary uses. Throws whatever the authenticator
 * throws on failure (never an internal error).
 */
export async function authenticateSocket(
  authenticator: HttpAuthenticator,
  socket: Socket,
): Promise<AuthenticatedUser> {
  return authenticator.authenticate({
    headers: socket.handshake.headers,
  } as unknown as Request);
}
