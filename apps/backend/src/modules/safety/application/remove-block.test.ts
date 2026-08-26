/**
 * Unit tests for the Phase 3.24 unblock use case.
 *
 * Verifies the soft-delete call shape and idempotency (no error whether or
 * not an active block existed — §10/§13, DECIDED).
 */
import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../lib/errors.js';
import { removeBlock } from './remove-block.js';

describe('removeBlock', () => {
  it('soft-deletes with the injected clock', async () => {
    const softDeleteBlock = vi.fn().mockResolvedValue({ count: 1 });
    const now = () => new Date('2026-08-21T12:00:00.000Z');

    await removeBlock(
      { blockerId: 'user-1', blockedId: 'user-2' },
      { softDeleteBlock, now },
    );

    expect(softDeleteBlock).toHaveBeenCalledWith({
      blockerId: 'user-1',
      blockedId: 'user-2',
      unblockedAt: new Date('2026-08-21T12:00:00.000Z'),
    });
  });

  it('succeeds even when zero rows were updated (idempotent, never a 404)', async () => {
    const softDeleteBlock = vi.fn().mockResolvedValue({ count: 0 });

    await expect(
      removeBlock(
        { blockerId: 'user-1', blockedId: 'user-2' },
        { softDeleteBlock, now: () => new Date() },
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects a missing blockerId/blockedUserId before touching persistence', async () => {
    const softDeleteBlock = vi.fn();

    await expect(
      removeBlock({ blockerId: '', blockedId: 'user-2' }, { softDeleteBlock }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      removeBlock(
        { blockerId: 'user-1', blockedId: '  ' },
        { softDeleteBlock },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(softDeleteBlock).not.toHaveBeenCalled();
  });
});
