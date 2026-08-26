/**
 * Session + user persistence (OD-005 — Phase 3.18).
 *
 * The only Prisma-touching auth infrastructure: the `AuthSession` table (see
 * `schema.prisma`) and find-or-create of a user by verified phone. Every
 * function runs inside the caller's transaction client (same convention as
 * the notification/ride repositories).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import type {
  SessionPersistence,
  SessionRow,
} from '../application/session-service.js';

export type { SessionRow } from '../application/session-service.js';

export interface CreateAuthSessionParams {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

/** Persists a new session (only the token hash is stored). */
export async function createAuthSession(
  client: Prisma.TransactionClient,
  params: CreateAuthSessionParams,
): Promise<{ id: string }> {
  return client.authSession.create({
    data: params,
    select: { id: true },
  });
}

/** Loads a session by its token hash (null when absent). */
export async function findAuthSessionByTokenHash(
  client: Prisma.TransactionClient,
  tokenHash: string,
): Promise<SessionRow | null> {
  return client.authSession.findUnique({
    where: { tokenHash },
    select: { userId: true, expiresAt: true, revokedAt: true },
  });
}

/** Revokes an active session by token hash (no-op when already revoked). */
export async function revokeAuthSession(
  client: Prisma.TransactionClient,
  tokenHash: string,
  revokedAt: Date,
): Promise<void> {
  await client.authSession.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt },
  });
}

/** Revokes every active session for a user. */
export async function revokeAuthSessionsForUser(
  client: Prisma.TransactionClient,
  userId: string,
  revokedAt: Date,
): Promise<void> {
  await client.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt },
  });
}

/**
 * Find-or-create the user for a verified phone. A newly-created user gets an
 * empty `name` until profile editing exists (Phase 3.x); the `phone` is
 * already canonical E.164 and unique.
 */
export async function upsertUserByPhone(
  client: Prisma.TransactionClient,
  phone: string,
): Promise<{ id: string }> {
  return client.user.upsert({
    where: { phone },
    create: { phone, name: '' },
    update: {},
    select: { id: true },
  });
}

/** Session persistence port bound to the Prisma client (one tx per op). */
export function createPrismaSessionPersistence(): SessionPersistence {
  return {
    createSession: (params) =>
      prisma.$transaction((tx) => createAuthSession(tx, params)),
    findSessionByTokenHash: (tokenHash) =>
      prisma.$transaction((tx) => findAuthSessionByTokenHash(tx, tokenHash)),
    revokeSession: (tokenHash, revokedAt) =>
      prisma.$transaction((tx) => revokeAuthSession(tx, tokenHash, revokedAt)),
    revokeUserSessions: (userId, revokedAt) =>
      prisma.$transaction((tx) =>
        revokeAuthSessionsForUser(tx, userId, revokedAt),
      ),
  };
}
