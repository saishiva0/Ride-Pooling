/**
 * Unit test for the Phase 3.24 "my blocks" listing use case (§10
 * `GET /blocks/mine`, owner-scoped, active-only).
 */
import { describe, expect, it, vi } from 'vitest';
import { listMyBlocks } from './list-my-blocks.js';
import type { ActiveBlockRow } from '../infrastructure/block.repository.js';

describe('listMyBlocks', () => {
  it('maps active block rows to the application shape', async () => {
    const row: ActiveBlockRow = {
      id: 'block-1',
      blockerId: 'user-1',
      blockedId: 'user-2',
      createdAt: new Date('2026-08-21T10:00:00.000Z'),
      unblockedAt: null,
      blocked: { id: 'user-2', name: 'Riya' },
    };
    const listActiveBlocksForUser = vi.fn().mockResolvedValue([row]);

    const result = await listMyBlocks('user-1', { listActiveBlocksForUser });

    expect(listActiveBlocksForUser).toHaveBeenCalledWith('user-1');
    expect(result).toEqual([
      {
        id: 'block-1',
        blockedUser: { id: 'user-2', name: 'Riya' },
        createdAt: new Date('2026-08-21T10:00:00.000Z'),
      },
    ]);
  });

  it('returns an empty list for a user with no active blocks', async () => {
    const listActiveBlocksForUser = vi.fn().mockResolvedValue([]);
    const result = await listMyBlocks('user-1', { listActiveBlocksForUser });
    expect(result).toEqual([]);
  });
});
