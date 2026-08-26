/**
 * Identity verification application service (Phase 3.9).
 *
 * Provider-independent: given an already-authenticated identity (produced by
 * the authentication boundary — the bearer authenticator since OD-005 was
 * resolved in Phase 3.18), confirms the user still exists and returns the
 * minimal `AuthenticationResult`. This is the "retrieve user" step of the
 * authentication boundary (`docs/development/phase-3-9-notes.md` §5).
 *
 * Security behavior:
 *
 * - Malformed identity input fails closed with a GENERIC `AuthenticationError`
 *   (401) — never a validation or internal error that reveals structure.
 * - An unknown user produces the SAME generic error as any other failure, so
 *   the boundary never reveals whether an account exists (no enumeration).
 * - The returned identity is exactly the presented authenticated identity —
 *   the persistence layer cannot redirect it to a different user.
 * - No credentials, hashes, or tokens are ever read, logged, or returned.
 *
 * Persistence is dependency-injected so the service is unit-testable without
 * a database (same pattern as the notification/ride application services).
 */
import { AuthenticationError, InternalError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { findUserById } from '../infrastructure/auth.repository.js';
import {
  isAuthenticatedUser,
  type AuthenticatedUser,
  type AuthenticationResult,
} from '../domain/identity.js';

/** Persistence port: resolves a user id to minimal identity data. */
export interface IdentityVerificationPersistence {
  findUserById(userId: string): Promise<{ id: string } | null>;
}

/** Injected dependencies so the service is unit-testable without the DB. */
export interface IdentityVerificationDependencies {
  findUserById: (userId: string) => Promise<{ id: string } | null>;
}

const defaultDependencies = (): IdentityVerificationDependencies => ({
  findUserById: (userId) =>
    prisma.$transaction((tx) => findUserById(tx, userId)),
});

/**
 * Verifies that `identity` corresponds to a real, existing user.
 *
 * Throws `AuthenticationError` (401, generic message) for malformed input or
 * an unknown user, and `InternalError` (500, not exposed) for unexpected
 * persistence failures.
 */
export async function verifyAuthenticatedIdentity(
  identity: AuthenticatedUser,
  deps: Partial<IdentityVerificationDependencies> = {},
): Promise<AuthenticationResult> {
  const { findUserById: resolveUser } = {
    ...defaultDependencies(),
    ...deps,
  };

  // Fail closed: anything that is not a structurally valid authenticated
  // identity is treated as an authentication failure, never validated into
  // shape or reflected back.
  if (!isAuthenticatedUser(identity)) {
    throw new AuthenticationError('Authentication failed');
  }

  let user: { id: string } | null;
  try {
    user = await resolveUser(identity.userId);
  } catch (err) {
    // Never leak raw persistence errors at the authentication boundary.
    throw new InternalError('Failed to verify identity', { cause: err });
  }

  if (!user) {
    // Identical message to every other failure — no account enumeration.
    throw new AuthenticationError('Authentication failed');
  }

  // The result is the presented identity, not whatever the store returned:
  // the store can only confirm existence, never substitute a different user.
  return { user: { userId: identity.userId } };
}
