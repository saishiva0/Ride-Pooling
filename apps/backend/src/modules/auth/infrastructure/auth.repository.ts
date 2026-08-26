/**
 * Auth persistence (Phase 3.9; Phase 3.18 — OD-005 resolved).
 *
 * The persistence concerns this module owns: resolving a user id to the
 * minimal identity shape needed by the application boundary, and the
 * `AuthSession` token-hash rows (see `session.persistence.ts`). The `User`
 * model already exists from Phase 2 (`schema.prisma`) — no credential columns
 * were added (OD-005 resolved to phone+OTP, which keys on the existing phone
 * uniqueness).
 *
 * Runs inside the caller's transaction client (same convention as the
 * notification and ride repositories). Returns `{ id }` only — no name,
 * contact fields, or anything the identity boundary does not need.
 */
import { Prisma } from '@prisma/client';

/** The minimal user identity row the auth boundary needs. */
export interface UserIdentityRow {
  id: string;
}

/** Loads a user by id, returning only the id (null when absent). */
export async function findUserById(
  client: Prisma.TransactionClient,
  userId: string,
): Promise<UserIdentityRow | null> {
  return client.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
}
