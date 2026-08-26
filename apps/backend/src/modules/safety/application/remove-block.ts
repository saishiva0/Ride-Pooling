/**
 * Unblock use case (Phase 3.24 — Reporting & Blocking).
 *
 * Soft-deletes an active block (`unblockedAt = now()`), never deleting the
 * row (§9/§13 — DECIDED, Product owner decision, 2026-08-21). Idempotent by
 * construction: unblocking a pair with no active block still succeeds
 * (no-op) — never a 404 (§10, §13).
 *
 * Does NOT cancel any existing CONFIRMED participation between the two
 * users — this use case never touches `RideParticipant`, and either party
 * may still use the existing Phase 3.21 cancellation flow if they want out
 * (§13 — DECIDED).
 *
 * A single atomic Prisma operation (`updateMany`) — no transaction wrapper
 * is needed (mirrors the Phase 3.23 device-token lesson: don't wrap a
 * single already-atomic write in an unnecessary transaction).
 */
import { ValidationError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { softDeleteBlock } from '../infrastructure/block.repository.js';

export interface RemoveBlockInput {
  blockerId: string;
  blockedId: string;
}

export interface RemoveBlockDependencies {
  softDeleteBlock: (params: {
    blockerId: string;
    blockedId: string;
    unblockedAt: Date;
  }) => Promise<{ count: number }>;
  now: () => Date;
}

function defaultDependencies(): RemoveBlockDependencies {
  return {
    softDeleteBlock: (params) => softDeleteBlock(prisma, params),
    now: () => new Date(),
  };
}

function assertValidInput(input: RemoveBlockInput): void {
  if (typeof input.blockerId !== 'string' || input.blockerId.trim() === '') {
    throw new ValidationError('blockerId is required', {
      field: 'blockerId',
    });
  }
  if (typeof input.blockedId !== 'string' || input.blockedId.trim() === '') {
    throw new ValidationError('blockedUserId is required', {
      field: 'blockedUserId',
    });
  }
}

/**
 * Unblocks `blockedId` on behalf of `blockerId`. Always succeeds (idempotent
 * soft delete) — the caller returns 204 regardless of whether a row existed
 * or was already inactive.
 */
export async function removeBlock(
  input: RemoveBlockInput,
  deps: Partial<RemoveBlockDependencies> = {},
): Promise<void> {
  const { softDeleteBlock: softDelete, now } = {
    ...defaultDependencies(),
    ...deps,
  };

  assertValidInput(input);

  await softDelete({
    blockerId: input.blockerId,
    blockedId: input.blockedId,
    unblockedAt: now(),
  });
}
