/**
 * Bearer-token HTTP authenticator (OD-005 — Phase 3.18).
 *
 * The concrete `HttpAuthenticator` for the approved opaque-bearer sessions:
 * reads `Authorization: Bearer <token>`, resolves it through the session
 * service, and throws the SAME generic 401 for every failure (missing header,
 * malformed scheme, unknown/expired/revoked token) so clients can never tell
 * which failure occurred.
 */
import type { Request } from 'express';
import { AuthenticationError } from '../../../lib/errors.js';
import type { SessionService } from '../application/session-service.js';
import type { HttpAuthenticator } from './auth.middleware.js';

/** Extracts the bearer token from `Authorization: Bearer <token>`. */
export function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || header.trim() === '') {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/** Builds the bearer-token authenticator backed by `sessionService`. */
export function createBearerTokenAuthenticator(
  sessionService: SessionService,
): HttpAuthenticator {
  return {
    async authenticate(req: Request) {
      const token = getBearerToken(req);
      if (!token) {
        throw new AuthenticationError('Authentication failed');
      }
      const user = await sessionService.validate(token);
      if (!user) {
        throw new AuthenticationError('Authentication failed');
      }
      return user;
    },
  };
}
