/**
 * Unit tests for the Phase 3.24 block creation use case.
 *
 * No PostgreSQL required: the `runTransaction` persistence port is faked.
 * Covers self-block rejection, target existence, ride-co-participant
 * scoping (403, DECIDED), idempotent no-op on an already-active block,
 * reactivation of a previously-unblocked (soft-deleted) row (DECIDED), and
 * error translation (including a unique-constraint race).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AuthorizationError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import { createBlock } from './create-block.js';
import type {
  BlockPersistence,
  CreateBlockDependencies,
} from './create-block.js';
import type { BlockRow } from '../infrastructure/block.repository.js';

function fakePersistence(
  overrides: Partial<BlockPersistence> = {},
): BlockPersistence {
  return {
    findBlockedUser: vi.fn(),
    areCoParticipants: vi.fn(),
    findExistingBlock: vi.fn(),
    createBlock: vi.fn(),
    reactivateBlock: vi.fn(),
    classifyError: vi.fn(() => null),
    ...overrides,
  };
}

const blockerId = 'user-1';
const blockedId = 'user-2';

function blockRow(overrides: Partial<BlockRow> = {}): BlockRow {
  return {
    id: 'block-1',
    blockerId,
    blockedId,
    createdAt: new Date('2026-08-21T10:00:00.000Z'),
    unblockedAt: null,
    ...overrides,
  };
}

function happyPersistence(): BlockPersistence {
  return fakePersistence({
    findBlockedUser: vi.fn().mockResolvedValue({ id: blockedId }),
    areCoParticipants: vi.fn().mockResolvedValue(true),
    findExistingBlock: vi.fn().mockResolvedValue(null),
    createBlock: vi.fn().mockResolvedValue(blockRow()),
    reactivateBlock: vi.fn().mockResolvedValue(blockRow({ unblockedAt: null })),
  });
}

async function run(persistence: BlockPersistence) {
  return createBlock(
    { blockerId, blockedId },
    { runTransaction: async (work) => work(persistence) },
  );
}

describe('createBlock — brand new block', () => {
  it('creates a new active row and reports created: true (201)', async () => {
    const persistence = happyPersistence();
    const outcome = await run(persistence);

    expect(outcome.created).toBe(true);
    expect(outcome.block).toEqual({
      id: 'block-1',
      blockerId,
      blockedId,
      createdAt: new Date('2026-08-21T10:00:00.000Z'),
      unblockedAt: null,
    });
    expect(persistence.createBlock).toHaveBeenCalledWith({
      blockerId,
      blockedId,
    });
    expect(persistence.reactivateBlock).not.toHaveBeenCalled();
  });
});

describe('createBlock — idempotency (§13, DECIDED)', () => {
  it('is a no-op (created: false) when already actively blocked', async () => {
    const persistence = happyPersistence();
    const existing = blockRow({ unblockedAt: null });
    persistence.findExistingBlock = vi.fn().mockResolvedValue(existing);

    const outcome = await run(persistence);

    expect(outcome.created).toBe(false);
    expect(outcome.block.id).toBe(existing.id);
    expect(persistence.createBlock).not.toHaveBeenCalled();
    expect(persistence.reactivateBlock).not.toHaveBeenCalled();
  });

  it('reactivates the SAME row when a previously-unblocked row exists', async () => {
    const persistence = happyPersistence();
    const existing = blockRow({
      id: 'block-old',
      unblockedAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    persistence.findExistingBlock = vi.fn().mockResolvedValue(existing);
    persistence.reactivateBlock = vi
      .fn()
      .mockResolvedValue(blockRow({ id: 'block-old', unblockedAt: null }));

    const outcome = await run(persistence);

    expect(outcome.created).toBe(false);
    expect(outcome.block.id).toBe('block-old');
    expect(outcome.block.unblockedAt).toBeNull();
    expect(persistence.reactivateBlock).toHaveBeenCalledWith('block-old');
    expect(persistence.createBlock).not.toHaveBeenCalled();
  });
});

describe('createBlock — self-block rule', () => {
  it('rejects blocking yourself with a 400 ValidationError', async () => {
    const persistence = happyPersistence();
    await expect(
      createBlock(
        { blockerId, blockedId: blockerId },
        { runTransaction: async (work) => work(persistence) },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(persistence.createBlock).not.toHaveBeenCalled();
  });
});

describe('createBlock — input validation', () => {
  it('rejects a missing blockerId/blockedUserId before touching persistence', async () => {
    const runTransaction = vi.fn();
    const deps: Partial<CreateBlockDependencies> = { runTransaction };

    await expect(
      createBlock({ blockerId: '', blockedId }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createBlock({ blockerId, blockedId: '   ' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('createBlock — target existence and co-participant scope', () => {
  it('rejects a nonexistent target with 404, before the co-participant check', async () => {
    const persistence = happyPersistence();
    persistence.findBlockedUser = vi.fn().mockResolvedValue(null);
    persistence.areCoParticipants = vi.fn();

    await expect(run(persistence)).rejects.toBeInstanceOf(NotFoundError);
    expect(persistence.areCoParticipants).not.toHaveBeenCalled();
    expect(persistence.createBlock).not.toHaveBeenCalled();
  });

  it('rejects a non-co-participant target with 403 (DECIDED scope restriction)', async () => {
    const persistence = happyPersistence();
    persistence.areCoParticipants = vi.fn().mockResolvedValue(false);

    await expect(run(persistence)).rejects.toBeInstanceOf(AuthorizationError);
    expect(persistence.createBlock).not.toHaveBeenCalled();
  });
});

describe('createBlock — error translation', () => {
  it('treats a unique-constraint race as a no-op after re-reading', async () => {
    const persistence = happyPersistence();
    persistence.createBlock = vi.fn().mockRejectedValue(new Error('P2002'));
    persistence.classifyError = vi.fn(
      (_err: unknown): 'unique' | 'foreign_key' | null => 'unique',
    );
    persistence.findExistingBlock = vi
      .fn()
      .mockResolvedValueOnce(null) // pre-check: no row yet
      .mockResolvedValueOnce(blockRow()); // re-read after the race

    const outcome = await run(persistence);
    expect(outcome.created).toBe(false);
    expect(outcome.block.id).toBe('block-1');
  });

  it('translates a foreign-key race into a NotFoundError', async () => {
    const persistence = happyPersistence();
    persistence.createBlock = vi.fn().mockRejectedValue(new Error('P2003'));
    persistence.classifyError = vi.fn(
      (_err: unknown): 'unique' | 'foreign_key' | null => 'foreign_key',
    );

    await expect(run(persistence)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('wraps an unexpected persistence failure without leaking it directly', async () => {
    const persistence = happyPersistence();
    persistence.createBlock = vi
      .fn()
      .mockRejectedValue(new Error('connection reset by peer'));

    const promise = run(persistence);
    await expect(promise).rejects.toBeInstanceOf(InternalError);
    await expect(promise).rejects.not.toThrow('connection reset by peer');
  });
});
