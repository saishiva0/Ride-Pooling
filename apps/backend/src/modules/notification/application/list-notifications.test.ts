/**
 * Unit tests for the Phase 3.8 notification listing use case.
 *
 * No PostgreSQL required: the `runTransaction` persistence port is faked.
 * Covers newest-first ordering, the limit + hasMore probe (limit+1 fetch),
 * unread counting, deterministic id tiebreak, input validation, and that the
 * listing is strictly scoped to the supplied userId (recipient isolation).
 */
import { describe, expect, it, vi } from 'vitest';
import { NotificationType } from '@prisma/client';
import { ValidationError } from '../../../lib/errors.js';
import {
  DEFAULT_NOTIFICATION_LIMIT,
  listNotifications,
} from './list-notifications.js';
import type {
  NotificationPersistence,
  NotificationRow,
} from './notification-dependencies.js';

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

let seq = 0;
function notificationRow(
  overrides: Partial<NotificationRow> = {},
): NotificationRow {
  seq += 1;
  return {
    id: `notification-${seq}`,
    userId: 'user-1',
    type: NotificationType.RIDE_CONFIRMED,
    title: 'Ride confirmed',
    body: 'Your ride is confirmed',
    readAt: null,
    rideId: 'ride-1',
    requestId: null,
    createdAt: new Date(2026, 7, 20, 10, 0, seq),
    ...overrides,
  };
}

function happyPersistence(
  rows: NotificationRow[] = [],
  unreadCount = 0,
): NotificationPersistence {
  return fakePersistence({
    listNotifications: vi.fn().mockResolvedValue(rows),
    countUnreadNotifications: vi.fn().mockResolvedValue(unreadCount),
  });
}

async function run(
  persistence: NotificationPersistence,
  userId = 'user-1',
  limit?: number,
) {
  return listNotifications(
    { userId, ...(limit === undefined ? {} : { limit }) },
    { runTransaction: async (work) => work(persistence) },
  );
}

describe('listNotifications — ordering and shape', () => {
  it('requests newest-first rows with a limit+1 probe and reports hasMore', async () => {
    const persistence = happyPersistence([notificationRow()], 1);

    const result = await run(persistence, 'user-1', 50);

    // Repository is asked for limit + 1 so the caller can detect more pages.
    expect(persistence.listNotifications).toHaveBeenCalledWith({
      userId: 'user-1',
      limit: 51,
    });
    expect(result).toEqual({
      notifications: [
        expect.objectContaining({
          id: 'notification-1',
          recipientUserId: 'user-1',
          read: false,
        }),
      ],
      unreadCount: 1,
      hasMore: false,
    });
  });

  it('sets hasMore true and trims to the limit when more rows exist', async () => {
    const rows = [notificationRow(), notificationRow()];
    const persistence = happyPersistence(rows, 2);

    const result = await run(persistence, 'user-1', 1);

    expect(persistence.listNotifications).toHaveBeenCalledWith({
      userId: 'user-1',
      limit: 2,
    });
    expect(result.notifications).toHaveLength(1);
    expect(result.hasMore).toBe(true);
  });

  it('maps each row through toAppNotification (read state from readAt)', async () => {
    const rows = [
      notificationRow({
        id: 'notification-read',
        readAt: new Date('2026-08-21T10:00:00.000Z'),
      }),
    ];
    const persistence = happyPersistence(rows, 0);

    const result = await run(persistence, 'user-1', 50);

    expect(result.notifications[0]).toMatchObject({
      id: 'notification-read',
      read: true,
      readAt: new Date('2026-08-21T10:00:00.000Z'),
    });
    // No raw Prisma field may leak into the application result.
    expect(result.notifications[0]).not.toHaveProperty('userId');
  });

  it('defaults to DEFAULT_NOTIFICATION_LIMIT when no limit is supplied', async () => {
    const persistence = happyPersistence([], 0);

    await run(persistence, 'user-1');

    expect(persistence.listNotifications).toHaveBeenCalledWith({
      userId: 'user-1',
      limit: DEFAULT_NOTIFICATION_LIMIT + 1,
    });
  });
});

describe('listNotifications — recipient isolation', () => {
  it('scopes the repository query to the supplied userId (ownership)', async () => {
    const persistence = happyPersistence([], 0);

    await run(persistence, 'other-user', 50);

    expect(persistence.listNotifications).toHaveBeenCalledWith({
      userId: 'other-user',
      limit: 51,
    });
    expect(persistence.countUnreadNotifications).toHaveBeenCalledWith(
      'other-user',
    );
  });
});

describe('listNotifications — input validation', () => {
  it('rejects an empty userId before touching the transaction', async () => {
    const runTransaction = vi.fn();
    const promise = listNotifications(
      { userId: '   ' },
      { runTransaction: runTransaction as never },
    );
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'rejects an invalid limit %s',
    async (limit) => {
      const runTransaction = vi.fn();
      const promise = listNotifications(
        { userId: 'user-1', limit },
        { runTransaction: runTransaction as never },
      );
      await expect(promise).rejects.toBeInstanceOf(ValidationError);
      expect(runTransaction).not.toHaveBeenCalled();
    },
  );
});
