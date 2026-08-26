/**
 * Block creation use case (Phase 3.24 — Reporting & Blocking).
 *
 * Creates or reactivates a `Block` row against a ride co-participant. Flow:
 *
 *   validate input shape
 *   → self-block rule (blockedId === blockerId → ValidationError, 400)
 *   → blocked user must exist (→ NotFoundError, 404 — checked BEFORE the
 *     co-participant scope check, mirroring `create-report.ts`'s ordering)
 *   → ride-co-participant scope check (→ AuthorizationError, 403 — DECIDED,
 *     Product owner decision, 2026-08-21)
 *   → idempotent write (§13 — DECIDED):
 *       - no existing row            → create a new active row (`created: true`)
 *       - existing row, active       → no-op, return it (`created: false`)
 *       - existing row, inactive     → reactivate (clear `unblockedAt`,
 *         `created: false`) — the SAME row, per the soft-delete decision
 *
 * No notification, push, or realtime event is ever triggered by a block
 * (§16 — DECIDED, fully silent). Blocking does NOT cancel any existing
 * CONFIRMED participation between the two users (§13 — DECIDED); this use
 * case never touches `RideParticipant`.
 */
import {
  AppError,
  AuthorizationError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { isSelfTarget } from '../domain/safety-rules.js';
import { areRideCoParticipants } from '../infrastructure/co-participant.repository.js';
import {
  createBlock as persistBlock,
  findBlock,
  reactivateBlock,
  classifyBlockError,
  type BlockRow,
} from '../infrastructure/block.repository.js';

export type { BlockRow } from '../infrastructure/block.repository.js';

/** The blocking user's trusted input. `blockerId` always comes from auth. */
export interface CreateBlockInput {
  blockerId: string;
  blockedId: string;
}

/** The resulting block, shaped for application-layer consumers. */
export interface CreatedBlock {
  id: string;
  blockerId: string;
  blockedId: string;
  createdAt: Date;
  unblockedAt: Date | null;
}

/** `created: true` only for a brand-new row (proposed 201); otherwise 200. */
export interface CreateBlockOutcome {
  block: CreatedBlock;
  created: boolean;
}

/**
 * Persistence port used by `createBlock`, implemented by the infrastructure
 * layer inside a single database transaction.
 */
export interface BlockPersistence {
  findBlockedUser(userId: string): Promise<{ id: string } | null>;
  areCoParticipants(userA: string, userB: string): Promise<boolean>;
  findExistingBlock(
    blockerId: string,
    blockedId: string,
  ): Promise<BlockRow | null>;
  createBlock(params: {
    blockerId: string;
    blockedId: string;
  }): Promise<BlockRow>;
  reactivateBlock(id: string): Promise<BlockRow>;
  classifyError(err: unknown): 'unique' | 'foreign_key' | null;
}

/** Injected dependency so the use case is unit-testable without PostgreSQL. */
export interface CreateBlockDependencies {
  runTransaction: <T>(
    work: (persistence: BlockPersistence) => Promise<T>,
  ) => Promise<T>;
}

function defaultDependencies(): CreateBlockDependencies {
  return {
    runTransaction: (work) =>
      prisma.$transaction((tx) =>
        work({
          findBlockedUser: (userId) =>
            tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
          areCoParticipants: (userA, userB) =>
            areRideCoParticipants(tx, userA, userB),
          findExistingBlock: (blockerId, blockedId) =>
            findBlock(tx, blockerId, blockedId),
          createBlock: (params) => persistBlock(tx, params),
          reactivateBlock: (id) => reactivateBlock(tx, id),
          classifyError: classifyBlockError,
        }),
      ),
  };
}

function assertValidInput(input: CreateBlockInput): void {
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

function toCreatedBlock(record: BlockRow): CreatedBlock {
  return {
    id: record.id,
    blockerId: record.blockerId,
    blockedId: record.blockedId,
    createdAt: record.createdAt,
    unblockedAt: record.unblockedAt,
  };
}

/**
 * Creates or reactivates a block against a ride co-participant.
 *
 * Throws `ValidationError` (malformed input / self-block), `NotFoundError`
 * (404 — blocked user does not exist), `AuthorizationError` (403 — caller
 * and target are not ride co-participants), or `InternalError` for
 * unexpected persistence failures (never a raw Prisma error).
 */
export async function createBlock(
  input: CreateBlockInput,
  deps: Partial<CreateBlockDependencies> = {},
): Promise<CreateBlockOutcome> {
  const { runTransaction } = { ...defaultDependencies(), ...deps };

  assertValidInput(input);

  if (isSelfTarget(input.blockerId, input.blockedId)) {
    throw new ValidationError('You cannot block yourself', {
      field: 'blockedUserId',
    });
  }

  return runTransaction(async (persistence) => {
    const blockedUser = await persistence.findBlockedUser(input.blockedId);
    if (!blockedUser) {
      throw new NotFoundError('Blocked user not found', {
        field: 'blockedUserId',
        details: { blockedUserId: input.blockedId },
      });
    }

    const eligible = await persistence.areCoParticipants(
      input.blockerId,
      input.blockedId,
    );
    if (!eligible) {
      throw new AuthorizationError(
        'You can only block a user you have shared a ride with',
      );
    }

    const existing = await persistence.findExistingBlock(
      input.blockerId,
      input.blockedId,
    );

    if (existing && existing.unblockedAt === null) {
      // Already actively blocked — idempotent no-op (§13, DECIDED).
      return { block: toCreatedBlock(existing), created: false };
    }

    if (existing) {
      // Previously unblocked (soft-deleted) — reactivate the SAME row
      // rather than creating a second one (§9/§13, DECIDED).
      const reactivated = await persistence.reactivateBlock(existing.id);
      return { block: toCreatedBlock(reactivated), created: false };
    }

    try {
      const record = await persistence.createBlock({
        blockerId: input.blockerId,
        blockedId: input.blockedId,
      });
      return { block: toCreatedBlock(record), created: true };
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      const kind = persistence.classifyError(err);
      if (kind === 'unique') {
        // A concurrent create raced past the findExistingBlock check —
        // re-read and treat the result as the (already-created) no-op.
        const raced = await persistence.findExistingBlock(
          input.blockerId,
          input.blockedId,
        );
        if (raced) {
          return { block: toCreatedBlock(raced), created: false };
        }
      }
      if (kind === 'foreign_key') {
        throw new NotFoundError('Blocked user not found', {
          field: 'blockedUserId',
        });
      }
      throw new InternalError('Failed to create block', { cause: err });
    }
  });
}
