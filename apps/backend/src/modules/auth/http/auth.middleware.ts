/**
 * HTTP authentication seam (Phase 3.10; Phase 3.18 — OD-005 resolved).
 *
 * OD-005 was RESOLVED in Phase 3.18 (phone + OTP via MSG91, opaque bearer
 * sessions — see `docs/planning/open-decisions.md`); the concrete
 * `HttpAuthenticator` is `createBearerTokenAuthenticator` (see
 * `bearer-authenticator.ts`). This middleware is the seam through which the
 * authenticator plugs into the API. It consumes the provider-independent
 * abstractions (`HttpAuthenticator`, `AuthenticatedUser`,
 * `verifyAuthenticatedIdentity`) and NEVER trusts a caller-supplied actor/user
 * id from a request body or header as authentication.
 *
 * Fail-closed by design:
 *
 * - `failClosedAuthenticator` rejects EVERY request with a generic 401. It is
 *   the explicit default for tests and for any app created without an
 *   authenticator, so no protected endpoint is ever exposed by accident.
 * - `createTestAuthenticator()` is a deterministic TEST/DEVELOPMENT-ONLY
 *   authenticator (reads `x-test-user-id`). It must NEVER be wired in
 *   production; it exists so integration tests can establish an
 *   `AuthenticatedUser`. The app factory only activates it when explicitly
 *   injected (see `app.ts`).
 *
 * The middleware resolves the presented identity through Phase 3.9's
 * `verifyAuthenticatedIdentity` (user existence check) and stores the
 * resulting `AuthenticatedUser` on `res.locals` — immutable for the request.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  AppError,
  AuthenticationError,
  InternalError,
} from '../../../lib/errors.js';
import {
  createAuthenticatedUser,
  type AuthenticatedUser,
  type AuthenticationResult,
} from '../domain/identity.js';
import { verifyAuthenticatedIdentity } from '../application/verify-identity.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      /** The authenticated user, set by `createAuthMiddleware`. */
      authenticatedUser?: AuthenticatedUser;
    }
  }
}

/**
 * Resolves the authenticated identity from an HTTP request. Implementations
 * must throw `AuthenticationError` (401) with a generic message on ANY
 * failure — never reveal which account exists and never leak credentials.
 */
export interface HttpAuthenticator {
  authenticate(req: Request): Promise<AuthenticatedUser>;
}

/**
 * The explicit fail-closed default authenticator: rejects every request.
 * The concrete production authenticator is `createBearerTokenAuthenticator`
 * (Phase 3.18); this remains available so an app created without an
 * authenticator exposes no protected endpoint.
 */
export const failClosedAuthenticator: HttpAuthenticator = {
  async authenticate() {
    throw new AuthenticationError('Authentication failed');
  },
};

/**
 * TEST/DEVELOPMENT-ONLY authenticator. Reads the `x-test-user-id` header and
 * produces an `AuthenticatedUser` from it. Deterministic and isolated so
 * HTTP integration tests can exercise protected routes. NEVER use in
 * production — it intentionally trusts a header. Production stays fail-closed
 * because this is only active when explicitly injected by the app creator.
 */
export function createTestAuthenticator(): HttpAuthenticator {
  return {
    async authenticate(req) {
      const raw = req.headers['x-test-user-id'];
      const userId = Array.isArray(raw) ? raw[0] : raw;
      if (!userId || userId.trim() === '') {
        throw new AuthenticationError('Authentication failed');
      }
      return createAuthenticatedUser(userId.trim());
    },
  };
}

/**
 * Builds the Express middleware that enforces authentication. Resolves the
 * identity through `authenticator`, verifies the user exists (Phase 3.9
 * `verifyAuthenticatedIdentity` by default), and stores the immutable
 * `AuthenticatedUser` on `res.locals.authenticatedUser`.
 *
 * Failures are forwarded to the centralized error handler: AppErrors keep
 * their mapping (401/500); anything unexpected is wrapped so no raw error
 * reaches the client.
 */
export function createAuthMiddleware(
  authenticator: HttpAuthenticator,
  verify: (
    identity: AuthenticatedUser,
  ) => Promise<AuthenticationResult> = verifyAuthenticatedIdentity,
): RequestHandler {
  return function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    return authenticator
      .authenticate(req)
      .then((identity) => verify(identity))
      .then((result) => {
        res.locals.authenticatedUser = result.user;
        next();
      })
      .catch((err: unknown) => {
        if (err instanceof AppError) {
          next(err);
          return;
        }
        next(
          new InternalError('Authentication failed unexpectedly', {
            cause: err,
          }),
        );
      });
  };
}

/**
 * Reads the authenticated user attached by `createAuthMiddleware`. Throws a
 * generic `AuthenticationError` when absent (a protected route reached
 * without authentication — fails closed).
 */
export function getAuthenticatedUser(res: Response): AuthenticatedUser {
  const user = res.locals.authenticatedUser;
  if (!user) {
    throw new AuthenticationError('Authentication failed');
  }
  return user;
}
