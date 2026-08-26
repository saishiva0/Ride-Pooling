/**
 * Block persistence (Phase 3.24 — Reporting & Blocking).
 *
 * Owns every persistence detail for blocks: lookup (including inactive
 * rows, for the reactivate-on-re-block path), creation, soft-delete
 * (unblock), reactivation, the cross-module "is this pair actively
 * blocked" read (consulted by the `ride` module — never the reverse), and
 * listing a blocker's active blocks.
 *
 * DECIDED (Product owner decision, 2026-08-21, §9/§13): unblocking is a
 * SOFT DELETE — `unblockedAt` null = active, non-null = resolved/inactive.
 * The row is never deleted, so re-blocking after an unblock reactivates the
 * same row instead of creating a second one.
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

/** The raw persisted block row returned to callers. */
export interface BlockRow {
  id: string;
  blockerId: string;
  blockedId: string;
  createdAt: Date;
  unblockedAt: Date | null;
}

/** A block row plus the blocked user's display info (for `GET /blocks/mine`). */
export interface ActiveBlockRow extends BlockRow {
  blocked: { id: string; name: string };
}

const BLOCK_SELECT = {
  id: true,
  blockerId: true,
  blockedId: true,
  createdAt: true,
  unblockedAt: true,
} as const;

/**
 * Looks up the (at most one) block row for this ordered pair, active or
 * inactive — the read that decides whether a new POST /blocks creates,
 * no-ops, or reactivates (§13).
 */
export async function findBlock(
  client: Prisma.TransactionClient,
  blockerId: string,
  blockedId: string,
): Promise<BlockRow | null> {
  return client.block.findUnique({
    where: { blockerId_blockedId: { blockerId, blockedId } },
    select: BLOCK_SELECT,
  });
}

/** Inserts a new, active `Block` row. */
export async function createBlock(
  client: Prisma.TransactionClient,
  params: { blockerId: string; blockedId: string },
): Promise<BlockRow> {
  return client.block.create({
    data: { blockerId: params.blockerId, blockedId: params.blockedId },
    select: BLOCK_SELECT,
  });
}

/**
 * Reactivates a previously-unblocked row by clearing `unblockedAt` — the
 * SAME row, per the soft-delete retention decision (§9/§13). `createdAt` is
 * left untouched (it records the original block, not the reactivation).
 */
export async function reactivateBlock(
  client: Prisma.TransactionClient,
  id: string,
): Promise<BlockRow> {
  return client.block.update({
    where: { id },
    data: { unblockedAt: null },
    select: BLOCK_SELECT,
  });
}

/**
 * Soft-deletes (unblocks) an active block for this ordered pair. An
 * `updateMany` (rather than `update`) makes this naturally idempotent: a
 * pair with no active block simply matches zero rows — still a success
 * (§10, §13: unblocking a non-existent or already-inactive block is a 204
 * no-op, never a 404). Returns the number of rows updated.
 */
export async function softDeleteBlock(
  client: Prisma.TransactionClient,
  params: { blockerId: string; blockedId: string; unblockedAt: Date },
): Promise<{ count: number }> {
  const result = await client.block.updateMany({
    where: {
      blockerId: params.blockerId,
      blockedId: params.blockedId,
      unblockedAt: null,
    },
    data: { unblockedAt: params.unblockedAt },
  });
  return { count: result.count };
}

/**
 * Whether an ACTIVE block exists between `userA` and `userB`, in either
 * direction. This is the cross-module read the `ride` module's
 * discovery/matching and request-creation paths consult (§7, §13) — a
 * narrow, read-only dependency in the same direction Safety & Trust already
 * informs Ride Engine, never the reverse.
 */
export async function findActiveBlockBetween(
  client: Prisma.TransactionClient | PrismaClient,
  userA: string,
  userB: string,
): Promise<boolean> {
  const row = await client.block.findFirst({
    where: {
      unblockedAt: null,
      OR: [
        { blockerId: userA, blockedId: userB },
        { blockerId: userB, blockedId: userA },
      ],
    },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Lists a blocker's currently-active blocks (`unblockedAt IS NULL`), newest
 * first, with the blocked user's display info (§10 `GET /blocks/mine`).
 */
export async function listActiveBlocksForUser(
  client: Prisma.TransactionClient | PrismaClient,
  blockerId: string,
): Promise<ActiveBlockRow[]> {
  return client.block.findMany({
    where: { blockerId, unblockedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { ...BLOCK_SELECT, blocked: { select: { id: true, name: true } } },
  });
}

/**
 * Classifies a Prisma error thrown by a block insert so the application
 * layer can translate races into its own error structure — never a raw
 * Prisma error:
 *
 * - `unique` → a concurrent create raced past the same
 *   find-then-create/reactivate check (P2002 on the (blockerId, blockedId)
 *   unique constraint) — the caller re-reads and treats it as a no-op.
 * - `foreign_key` → the blocked user vanished between validation and insert
 *   (P2003).
 * - `null` → anything else.
 */
export function classifyBlockError(
  err: unknown,
): 'unique' | 'foreign_key' | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return 'unique';
    }
    if (err.code === 'P2003') {
      return 'foreign_key';
    }
  }
  return null;
}
