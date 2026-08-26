/**
 * Unit tests for the Phase 3.8 mark-one-notification-as-read use case.
 *
 * No PostgreSQL required: the `runTransaction` persistence port is faked.
 * Covers existence, ownership (one user may never mark another user's
 * notification read), idempotency for already-read notifications (no write),
 * input validation, and error translation.
 */
import { describe, expect, it, vi } from 'vitest';
import { NotificationType } from '@prisma/client';
import {
  AuthorizationError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import { markNotificationAsRead } from './mark-notification-as-read.js';
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

const OWNER = 'user-1';

function notificationRow(
  overrides: Partial<NotificationRow> = {},
): NotificationRow {
  return {
    id: 'notification-1',
    userId: OWNER,
    type: NotificationType.RIDE_CONFIRMED,
    title: 'Ride confirmed',
    body: 'Your ride is confirmed',
    readAt: null,
    rideId: 'ride-1',
    requestId: null,
    createdAt: new Date('2026-08-20T10:00:00.000Z'),
    ...overrides,
  };
}

function happyPersistence(): NotificationPersistence {
  return fakePersistence({
    findNotificationById: vi.fn().mockResolvedValue(notificationRow()),
    markNotificationRead: vi.fn().mockResolvedValue({ count: 1 }),
  });
}

async function run(
  persistence: NotificationPersistence,
  input: { notificationId: string; userId: string },
) {
  return markNotificationAsRead(input, {
    runTransaction: async (work) => work(persistence),
  });
}

describe('markNotificationAsRead — happy path', () => {
  it('marks an unread notification read and returns the updated typed result', async () => {
    const persistence = happyPersistence();
    const result = await run(persistence, {
      notificationId: 'notification-1',
      userId: OWNER,
    });

    expect(persistence.markNotificationRead).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'notification-1',
        userId: OWNER,
      }),
    );
    const call = vi.mocked(persistence.markNotificationRead).mock
      .calls[0]![0] as { readAt: Date };
    expect(call.readAt).toBeInstanceOf(Date);

    expect(result).toMatchObject({
      id: 'notification-1',
      recipientUserId: OWNER,
      read: true,
      rideId: 'ride-1',
    });
    expect(result.readAt).toBeInstanceOf(Date);
  });
});

describe('markNotificationAsRead — ownership', () => {
  it('rejects marking another user notification read with AuthorizationError and writes nothing', async () => {
    const persistence = happyPersistence();

    const promise = run(persistence, {
      notificationId: 'notification-1',
      userId: 'other-user',
    });
    await expect(promise).rejects.toBeInstanceOf(AuthorizationError);
    await expect(promise).rejects.toMatchObject({
      code: 'AUTHORIZATION_ERROR',
      statusCode: 403,
    });
    expect(persistence.markNotificationRead).not.toHaveBeenCalled();
  });
});

describe('markNotificationAsRead — idempotency', () => {
  it('returns the current state without writing when already read', async () => {
    const readAt = new Date('2026-08-21T10:00:00.000Z');
    const persistence = happyPersistence();
    persistence.findNotificationById = vi
      .fn()
      .mockResolvedValue(notificationRow({ readAt }));

    const result = await run(persistence, {
      notificationId: 'notification-1',
      userId: OWNER,
    });

    expect(result).toMatchObject({ read: true, readAt });
    // Already-read notifications are never re-written (readAt preserved).
    expect(persistence.markNotificationRead).not.toHaveBeenCalled();
  });
});

describe('markNotificationAsRead — missing notification', () => {
  it('throws NotFoundError when the notification does not exist', async () => {
    const persistence = happyPersistence();
    persistence.findNotificationById = vi.fn().mockResolvedValue(null);

    const promise = run(persistence, {
      notificationId: 'missing',
      userId: OWNER,
    });
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    await expect(promise).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
    expect(persistence.markNotificationRead).not.toHaveBeenCalled();
  });
});

describe('markNotificationAsRead — input validation', () => {
  it('rejects malformed input before touching the transaction', async () => {
    const runTransaction = vi.fn();
    const deps = { runTransaction: runTransaction as never };

    await expect(
      markNotificationAsRead({ notificationId: '', userId: OWNER }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      markNotificationAsRead(
        { notificationId: 'notification-1', userId: '   ' },
        deps,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('markNotificationAsRead — error translation', () => {
  it('wraps an unexpected persistence failure without leaking it directly', async () => {
    const persistence = happyPersistence();
    persistence.markNotificationRead = vi
      .fn()
      .mockRejectedValue(new Error('connection reset by peer'));

    const promise = run(persistence, {
      notificationId: 'notification-1',
      userId: OWNER,
    });
    await expect(promise).rejects.toBeInstanceOf(InternalError);
    await expect(promise).rejects.not.toThrow('connection reset by peer');
  });
});
