/**
 * Unit tests for the Phase 3.8 notification creation use case.
 *
 * No PostgreSQL required: the `runTransaction` persistence port is faked.
 * Covers input validation, recipient existence, supported-type enforcement,
 * centralized content defaults and overrides, FK-race translation, unexpected
 * persistence failures, and the typed result mapping (including the
 * AppNotification shape — no raw Prisma records leak).
 */
import { describe, expect, it, vi } from 'vitest';
import { NotificationType } from '@prisma/client';
import {
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import { createNotification } from './create-notification.js';
import type { CreateNotificationInput } from './create-notification.js';
import type { AppNotification } from './notification-dependencies.js';
import type {
  NotificationCreationParams,
  NotificationRow,
  NotificationPersistence,
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

function notificationRow(
  overrides: Partial<NotificationRow> = {},
): NotificationRow {
  return {
    id: 'notification-1',
    userId: 'user-1',
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
    findRecipient: vi.fn().mockResolvedValue({ id: 'user-1', name: 'Riya' }),
    createNotification: vi
      .fn()
      .mockImplementation((params: NotificationCreationParams) =>
        // Mirrors the repository: absent optional context is stored as NULL.
        notificationRow({
          userId: params.userId,
          type: params.type,
          title: params.title,
          body: params.body,
          rideId: params.rideId ?? null,
          requestId: params.requestId ?? null,
        }),
      ),
  });
}

async function run(
  persistence: NotificationPersistence,
  input: CreateNotificationInput,
): Promise<AppNotification> {
  return createNotification(input, {
    runTransaction: async (work) => work(persistence),
  });
}

const validInput: CreateNotificationInput = {
  recipientId: 'user-1',
  type: NotificationType.RIDE_CONFIRMED,
  rideId: 'ride-1',
};

describe('createNotification — valid creation', () => {
  it('creates a notification with the centralized content defaults and maps the result', async () => {
    const persistence = happyPersistence();
    const result = await run(persistence, validInput);

    expect(result).toEqual({
      id: 'notification-1',
      recipientUserId: 'user-1',
      type: NotificationType.RIDE_CONFIRMED,
      title: 'Ride confirmed',
      body: 'Your ride is confirmed',
      read: false,
      readAt: null,
      rideId: 'ride-1',
      requestId: null,
      createdAt: new Date('2026-08-20T10:00:00.000Z'),
    });
    expect(persistence.findRecipient).toHaveBeenCalledWith('user-1');
    expect(persistence.createNotification).toHaveBeenCalledWith({
      userId: 'user-1',
      type: NotificationType.RIDE_CONFIRMED,
      title: 'Ride confirmed',
      body: 'Your ride is confirmed',
      rideId: 'ride-1',
      requestId: undefined,
    });
  });

  it('passes through explicit title/body and ride/request context', async () => {
    const persistence = happyPersistence();
    const input: CreateNotificationInput = {
      recipientId: 'user-1',
      type: NotificationType.RIDE_REQUESTED,
      title: 'Custom title',
      body: 'Custom body',
      rideId: 'ride-9',
      requestId: 'req-9',
    };

    const result = await run(persistence, input);

    expect(result.title).toBe('Custom title');
    expect(result.body).toBe('Custom body');
    expect(result.rideId).toBe('ride-9');
    expect(result.requestId).toBe('req-9');
    expect(persistence.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Custom title',
        body: 'Custom body',
        rideId: 'ride-9',
        requestId: 'req-9',
      }),
    );
  });
});

describe('createNotification — input validation', () => {
  it.each([
    ['recipientId missing', { type: NotificationType.RIDE_CONFIRMED }],
    [
      'recipientId empty',
      { recipientId: '   ', type: NotificationType.RIDE_CONFIRMED },
    ],
    ['type missing', { recipientId: 'user-1' }],
  ])('rejects %s before touching the transaction', async (_label, partial) => {
    const runTransaction = vi.fn();
    const promise = createNotification(partial as CreateNotificationInput, {
      runTransaction: runTransaction as never,
    });
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('rejects a valid-but-unsupported notification type (not wired this phase)', async () => {
    const runTransaction = vi.fn();
    const promise = createNotification(
      {
        recipientId: 'user-1',
        type: NotificationType.RIDE_STARTED,
      },
      { runTransaction: runTransaction as never },
    );
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({ field: 'type' });
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('rejects empty title/body overrides', async () => {
    const runTransaction = vi.fn();
    await expect(
      createNotification(
        {
          recipientId: 'user-1',
          type: NotificationType.RIDE_CONFIRMED,
          title: '',
        },
        { runTransaction: runTransaction as never },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createNotification(
        {
          recipientId: 'user-1',
          type: NotificationType.RIDE_CONFIRMED,
          body: '   ',
        },
        { runTransaction: runTransaction as never },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('createNotification — recipient existence', () => {
  it('rejects a missing recipient with NotFoundError and writes nothing', async () => {
    const persistence = happyPersistence();
    persistence.findRecipient = vi.fn().mockResolvedValue(null);

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    await expect(promise).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
      field: 'recipientId',
    });
    expect(persistence.createNotification).not.toHaveBeenCalled();
  });
});

describe('createNotification — error translation', () => {
  it('translates an FK race (recipient vanished) into NotFoundError', async () => {
    const persistence = happyPersistence();
    persistence.createNotification = vi
      .fn()
      .mockRejectedValue(new Error('P2003'));
    persistence.classifyError = vi.fn(
      (_err: unknown): 'foreign_key' | null => 'foreign_key',
    );

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    await expect(promise).rejects.not.toThrow('P2003');
  });

  it('propagates an AppError raised by persistence unchanged', async () => {
    const persistence = happyPersistence();
    persistence.createNotification = vi
      .fn()
      .mockRejectedValue(new NotFoundError('nope', { field: 'rideId' }));

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('wraps an unexpected persistence failure without leaking it directly', async () => {
    const persistence = happyPersistence();
    persistence.createNotification = vi
      .fn()
      .mockRejectedValue(new Error('connection reset by peer'));

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(InternalError);
    await expect(promise).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    });
    await expect(promise).rejects.not.toThrow('connection reset by peer');
  });
});

describe('createNotification — result mapping (no raw Prisma leakage)', () => {
  it('maps a read notification to read: true with the readAt timestamp', async () => {
    const persistence = happyPersistence();
    persistence.createNotification = vi
      .fn()
      .mockResolvedValue(
        notificationRow({ readAt: new Date('2026-08-21T10:00:00.000Z') }),
      );

    const result = await run(persistence, validInput);
    expect(result.read).toBe(true);
    expect(result.readAt).toEqual(new Date('2026-08-21T10:00:00.000Z'));
    // No raw Prisma field (userId) may leak into the application result.
    expect(result).not.toHaveProperty('userId');
  });
});
