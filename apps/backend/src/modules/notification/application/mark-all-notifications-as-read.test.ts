/**
 * Unit tests for the Phase 3.8 mark-all-notifications-as-read use case.
 *
 * No PostgreSQL required: the `runTransaction` persistence port is faked.
 * Covers the single efficient update, the returned updated count, recipient
 * scoping, the idempotent unknown-user no-op, and input validation.
 */
import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../lib/errors.js';
import { markAllNotificationsAsRead } from './mark-all-notifications-as-read.js';
import type { NotificationPersistence } from './notification-dependencies.js';

function fakePersistence(
  overrides: Partial<NotificationPersistence> = {},
): NotificationPersistence {
  return {
    findRecipient: vi.fn(),
    createNotification: vi.fn(),
    findNotificationById: vi.fn(),
    listNotifications: vi.fn(),
    countUnreadNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    classifyError: vi.fn(() => null),
    ...overrides,
  };
}

function happyPersistence(count = 3): NotificationPersistence {
  return fakePersistence({
    markAllNotificationsRead: vi.fn().mockResolvedValue({ count }),
  });
}

async function run(persistence: NotificationPersistence, userId: string) {
  return markAllNotificationsAsRead(
    { userId },
    { runTransaction: async (work) => work(persistence) },
  );
}

describe('markAllNotificationsAsRead — happy path', () => {
  it('marks all unread notifications read in one operation and returns the updated count', async () => {
    const persistence = happyPersistence(3);
    const result = await run(persistence, 'user-1');

    expect(persistence.markAllNotificationsRead).toHaveBeenCalledTimes(1);
    const call = vi.mocked(persistence.markAllNotificationsRead).mock
      .calls[0]![0] as { userId: string; readAt: Date };
    expect(call.userId).toBe('user-1');
    expect(call.readAt).toBeInstanceOf(Date);
    expect(result).toEqual({ updatedCount: 3 });
  });

  it('is scoped to the supplied recipient only', async () => {
    const persistence = happyPersistence(0);
    await run(persistence, 'other-user');
    expect(persistence.markAllNotificationsRead).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'other-user' }),
    );
  });
});

describe('markAllNotificationsAsRead — idempotency', () => {
  it('returns updatedCount 0 when there is nothing unread (idempotent)', async () => {
    const persistence = happyPersistence(0);
    const result = await run(persistence, 'user-1');
    expect(result).toEqual({ updatedCount: 0 });
  });

  it('is a successful no-op for an unknown user (no notifications to update)', async () => {
    const persistence = happyPersistence(0);
    const result = await run(persistence, 'ghost-user');
    expect(result).toEqual({ updatedCount: 0 });
  });
});

describe('markAllNotificationsAsRead — input validation', () => {
  it('rejects an empty userId before touching the transaction', async () => {
    const runTransaction = vi.fn();
    const promise = markAllNotificationsAsRead(
      { userId: '  ' },
      { runTransaction: runTransaction as never },
    );
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});
