/**
 * Real-database integration tests for Phase 3.24 block persistence:
 * creation, soft-delete (unblock), reactivation, the cross-module active-
 * block read, listing a blocker's active blocks, and FK/unique-race
 * classification.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import {
  classifyBlockError,
  createBlock,
  findActiveBlockBetween,
  findBlock,
  listActiveBlocksForUser,
  reactivateBlock,
  softDeleteBlock,
} from './block.repository.js';

const RUN_ID = `blocktest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let seq = 0;
function unique(label: string): string {
  seq += 1;
  return `${RUN_ID}_${label}_${seq}`;
}

const cleanup = { userIds: [] as string[] };

afterAll(async () => {
  await prisma.block.deleteMany({
    where: {
      OR: [
        { blockerId: { in: cleanup.userIds } },
        { blockedId: { in: cleanup.userIds } },
      ],
    },
  });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.$disconnect();
});

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: { name: `Test ${label}`, phone: `+91${unique(label)}` },
  });
  cleanup.userIds.push(user.id);
  return user;
}

describe('createBlock / findBlock — real database integration', () => {
  it('creates an active block (unblockedAt null)', async () => {
    const blocker = await createUser('create-blocker');
    const blocked = await createUser('create-blocked');

    const block = await prisma.$transaction((tx) =>
      createBlock(tx, { blockerId: blocker.id, blockedId: blocked.id }),
    );

    expect(block.unblockedAt).toBeNull();

    const found = await prisma.$transaction((tx) =>
      findBlock(tx, blocker.id, blocked.id),
    );
    expect(found?.id).toBe(block.id);
  });
});

describe('softDeleteBlock — unblock (§9/§13, DECIDED soft delete)', () => {
  it('sets unblockedAt and retains the row (idempotent on a second call)', async () => {
    const blocker = await createUser('unblock-blocker');
    const blocked = await createUser('unblock-blocked');
    await prisma.$transaction((tx) =>
      createBlock(tx, { blockerId: blocker.id, blockedId: blocked.id }),
    );

    const first = await softDeleteBlock(prisma, {
      blockerId: blocker.id,
      blockedId: blocked.id,
      unblockedAt: new Date(),
    });
    expect(first.count).toBe(1);

    const stored = await prisma.$transaction((tx) =>
      findBlock(tx, blocker.id, blocked.id),
    );
    expect(stored).not.toBeNull();
    expect(stored?.unblockedAt).not.toBeNull();

    // Idempotent: unblocking an already-inactive block matches zero rows,
    // never errors, and never double-updates.
    const second = await softDeleteBlock(prisma, {
      blockerId: blocker.id,
      blockedId: blocked.id,
      unblockedAt: new Date(),
    });
    expect(second.count).toBe(0);
  });

  it('is a no-op (zero rows) when no block ever existed', async () => {
    const blocker = await createUser('unblock-none-blocker');
    const blocked = await createUser('unblock-none-blocked');

    const result = await softDeleteBlock(prisma, {
      blockerId: blocker.id,
      blockedId: blocked.id,
      unblockedAt: new Date(),
    });
    expect(result.count).toBe(0);
  });
});

describe('reactivateBlock — re-block after unblock (§9/§13, DECIDED)', () => {
  it('clears unblockedAt on the SAME row rather than creating a new one', async () => {
    const blocker = await createUser('reactivate-blocker');
    const blocked = await createUser('reactivate-blocked');
    const original = await prisma.$transaction((tx) =>
      createBlock(tx, { blockerId: blocker.id, blockedId: blocked.id }),
    );
    await softDeleteBlock(prisma, {
      blockerId: blocker.id,
      blockedId: blocked.id,
      unblockedAt: new Date(),
    });

    const reactivated = await prisma.$transaction((tx) =>
      reactivateBlock(tx, original.id),
    );

    expect(reactivated.id).toBe(original.id);
    expect(reactivated.unblockedAt).toBeNull();

    const rowCount = await prisma.block.count({
      where: { blockerId: blocker.id, blockedId: blocked.id },
    });
    expect(rowCount).toBe(1);
  });
});

describe('findActiveBlockBetween — cross-module read consulted by `ride`', () => {
  it('is true when either user has actively blocked the other', async () => {
    const a = await createUser('active-a');
    const b = await createUser('active-b');
    await prisma.$transaction((tx) =>
      createBlock(tx, { blockerId: a.id, blockedId: b.id }),
    );

    expect(await findActiveBlockBetween(prisma, a.id, b.id)).toBe(true);
    expect(await findActiveBlockBetween(prisma, b.id, a.id)).toBe(true);
  });

  it('is false once the block has been unblocked', async () => {
    const a = await createUser('resolved-a');
    const b = await createUser('resolved-b');
    await prisma.$transaction((tx) =>
      createBlock(tx, { blockerId: a.id, blockedId: b.id }),
    );
    await softDeleteBlock(prisma, {
      blockerId: a.id,
      blockedId: b.id,
      unblockedAt: new Date(),
    });

    expect(await findActiveBlockBetween(prisma, a.id, b.id)).toBe(false);
  });

  it('is false for two users with no block at all', async () => {
    const a = await createUser('none-a');
    const b = await createUser('none-b');

    expect(await findActiveBlockBetween(prisma, a.id, b.id)).toBe(false);
  });
});

describe('listActiveBlocksForUser — GET /blocks/mine (§10)', () => {
  it('lists only the blocker own ACTIVE blocks, not resolved ones', async () => {
    const blocker = await createUser('list-blocker');
    const activeTarget = await createUser('list-active-target');
    const resolvedTarget = await createUser('list-resolved-target');

    await prisma.$transaction((tx) =>
      createBlock(tx, { blockerId: blocker.id, blockedId: activeTarget.id }),
    );
    await prisma.$transaction((tx) =>
      createBlock(tx, {
        blockerId: blocker.id,
        blockedId: resolvedTarget.id,
      }),
    );
    await softDeleteBlock(prisma, {
      blockerId: blocker.id,
      blockedId: resolvedTarget.id,
      unblockedAt: new Date(),
    });

    const active = await listActiveBlocksForUser(prisma, blocker.id);
    expect(active.map((b) => b.blockedId)).toEqual([activeTarget.id]);
    expect(active[0]?.blocked.id).toBe(activeTarget.id);
  });

  it('does not list blocks made against the caller (blockedId, not blockerId)', async () => {
    const blocker = await createUser('list-not-mine-blocker');
    const blocked = await createUser('list-not-mine-blocked');
    await prisma.$transaction((tx) =>
      createBlock(tx, { blockerId: blocker.id, blockedId: blocked.id }),
    );

    const asBlockedUser = await listActiveBlocksForUser(prisma, blocked.id);
    expect(asBlockedUser).toHaveLength(0);
  });
});

describe('classifyBlockError', () => {
  it('classifies a P2002 unique-constraint race', () => {
    const err = new Prisma.PrismaClientKnownRequestError('unique violation', {
      code: 'P2002',
      clientVersion: 'test',
    });
    expect(classifyBlockError(err)).toBe('unique');
  });

  it('classifies a P2003 foreign-key violation', () => {
    const err = new Prisma.PrismaClientKnownRequestError('FK violation', {
      code: 'P2003',
      clientVersion: 'test',
    });
    expect(classifyBlockError(err)).toBe('foreign_key');
  });

  it('returns null for an unrelated error', () => {
    expect(classifyBlockError(new Error('boom'))).toBeNull();
  });
});
