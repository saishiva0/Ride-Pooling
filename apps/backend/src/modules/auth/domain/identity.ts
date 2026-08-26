/**
 * Provider-independent authenticated identity (Phase 3.9; Phase 3.18 —
 * OD-005 resolved).
 *
 * OD-005 was RESOLVED in Phase 3.18 (phone + OTP via MSG91, opaque bearer
 * sessions — see `docs/planning/open-decisions.md`). These types remain the
 * minimal, provider-independent identity the API layer receives from the
 * authenticator — whichever mechanism produced it.
 *
 * The identity carries ONLY what authorization and application boundaries
 * need: the user id. No credentials, password hashes, tokens, provider data,
 * or Prisma types ever appear here — the authentication domain stays free of
 * the persistence layer per `docs/architecture/module-boundaries.md` §5.
 */
import { ValidationError } from '../../../lib/errors.js';

/**
 * A user proven authenticated by the authentication boundary. The only
 * field is `userId` — the identity required for ownership checks. Never
 * constructed directly from caller input; use `createAuthenticatedUser`.
 */
export interface AuthenticatedUser {
  readonly userId: string;
}

/** Result of a successful authentication: the authenticated identity. */
export interface AuthenticationResult {
  readonly user: AuthenticatedUser;
}

/**
 * Structural guard: true when `value` is an object with a non-blank string
 * `userId`. Used by the application boundary to reject malformed identity
 * input safely (fail closed).
 */
export function isAuthenticatedUser(
  value: unknown,
): value is AuthenticatedUser {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const userId = (value as { userId?: unknown }).userId;
  return typeof userId === 'string' && userId.trim() !== '';
}

/**
 * Creates an authenticated identity from a verified user id. This is the only
 * legitimate entry point for identity objects — a plain id string must never
 * be treated as identity without passing through here (or an equivalent
 * authentication boundary).
 *
 * Throws `ValidationError` when the id is missing, blank, or not a string.
 */
export function createAuthenticatedUser(userId: string): AuthenticatedUser {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new ValidationError('userId is required', { field: 'userId' });
  }
  return { userId };
}

/** Creates the authentication result for a verified user id. */
export function createAuthenticationResult(
  userId: string,
): AuthenticationResult {
  return { user: createAuthenticatedUser(userId) };
}
