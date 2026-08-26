/**
 * Unit tests for the Phase 3.24 cross-module block-check read consulted by
 * the `ride` module's discovery and request-creation paths (§7/§13).
 */
import { describe, expect, it, vi } from 'vitest';
import { isBlockedPair } from './block-check.js';

describe('isBlockedPair', () => {
  it('delegates to the injected active-block lookup', async () => {
    const findActiveBlockBetween = vi.fn().mockResolvedValue(true);

    const result = await isBlockedPair('user-1', 'user-2', {
      findActiveBlockBetween,
    });

    expect(result).toBe(true);
    expect(findActiveBlockBetween).toHaveBeenCalledWith('user-1', 'user-2');
  });

  it('is false for two identical ids without consulting the database', async () => {
    const findActiveBlockBetween = vi.fn();

    const result = await isBlockedPair('user-1', 'user-1', {
      findActiveBlockBetween,
    });

    expect(result).toBe(false);
    expect(findActiveBlockBetween).not.toHaveBeenCalled();
  });

  it('propagates false when no active block exists', async () => {
    const findActiveBlockBetween = vi.fn().mockResolvedValue(false);
    const result = await isBlockedPair('user-1', 'user-2', {
      findActiveBlockBetween,
    });
    expect(result).toBe(false);
  });
});
