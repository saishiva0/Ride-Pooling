/**
 * Phase 3.8 real-database integration tests for the notification module.
 *
 * Exercises the notification application services (`createNotification`,
 * `listNotifications`, `markNotificationAsRead`, `markAllNotificationsAsRead`)
 * and the repository functions against the real PostgreSQL database:
 * persistence, newest-first listing, unread counting, read-state updates,
 * recipient isolation, FK behaviour, and genuine mid-transaction rollback
 * (a notification never outlives a failed operation).
 *
 * Requires a reachable dev database with the Phase 2 migration applied.
 * Fixtures follow the existing conventions: RUN_ID prefixes, cleanup in
 * `afterAll` (notifications reference users with ON DELETE RESTRICT, so they
 * are removed before the users that own them).
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { NotificationType, PricingType, RideStatus } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { NotFoundError } from '../../../lib/errors.js';
import { createNotification } from '../application/create-notification.js';
import { listNotifications } from '../application/list-notifications.js';
import { markNotificationAsRead } from '../application/mark-notification-as-read.js';
import { markAllNotificationsAsRead } from '../application/mark-all-notifications-as-read.js';
import {
  persistNotification,
  type NotificationCreationParams,
} from './notification.repository.js';

const RUN_ID = `notiftest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let seq = 0;
function unique(label: string): string {
  seq += 1;
  return `${RUN_ID}_${label}_${seq}`;
}

const cleanup = {
  notificationIds: [] as string[],
  requestIds: [] as string[],
  rideIds: [] as string[],
  locationIds: [] as string[],
  userIds: [] as string[],
};

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { id: { in: cleanup.notificationIds } },
  });
  await prisma.rideRequest.deleteMany({
    where: { id: { in: cleanup.requestIds } },
  });
  await prisma.rideStatusHistory.deleteMany({
    where: { rideId: { in: cleanup.rideIds } },
  });
  await prisma.ride.deleteMany({ where: { id: { in: cleanup.rideIds } } });
  await prisma.location.deleteMany({
    where: { id: { in: cleanup.locationIds } },
  });
  await prisma.notification.deleteMany({
    where: { userId: { in: cleanup.userIds } },
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

async function createLocation(latitude: number, longitude: number) {
  const location = await prisma.location.create({
    data: { latitude, longitude, label: unique('loc') },
  });
  cleanup.locationIds.push(location.id);
  return location;
}

/** Creates a ride (context reference for ride-scoped notifications). */
async function createRideFixture(creatorId: string) {
  const pickup = await createLocation(17.385, 78.4867);
  const destination = await createLocation(17.4399, 78.4983);
  const ride = await prisma.ride.create({
    data: {
      creatorId,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
      departureDateTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      totalSeats: 3,
      vehicleType: unique('vehicle'),
      pricingType: PricingType.STANDARD,
      pricePerKm: 4,
      status: RideStatus.PUBLISHED,
    },
  });
  cleanup.rideIds.push(ride.id);
  return ride;
}

async function createRequestFixture(
  rideId: string,
  userId: string,
): Promise<{ id: string }> {
  const request = await prisma.rideRequest.create({
    data: { rideId, userId, requestedSeats: 1, status: 'PENDING' },
    select: { id: true },
  });
  cleanup.requestIds.push(request.id);
  return request;
}

/** Directly persisted notification (fixture setup), tracked for cleanup. */
async function persistFixture(
  params: NotificationCreationParams,
  createdAt?: Date,
) {
  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      rideId: params.rideId ?? null,
      requestId: params.requestId ?? null,
      ...(createdAt ? { createdAt } : {}),
    },
  });
  cleanup.notificationIds.push(notification.id);
  return notification;
}

describe('createNotification — real database integration', () => {
  it('persists a notification and returns the typed application result', async () => {
    const recipient = await createUser('recipient');
    const { id: rideId } = await createRideFixture(recipient.id);
    const { id: requestId } = await createRequestFixture(rideId, recipient.id);

    const result = await createNotification({
      recipientId: recipient.id,
      type: NotificationType.RIDE_REQUESTED,
      rideId,
      requestId,
    });
    cleanup.notificationIds.push(result.id);

    expect(result).toMatchObject({
      recipientUserId: recipient.id,
      type: NotificationType.RIDE_REQUESTED,
      title: 'New ride request',
      body: 'A participant requested to join your ride',
      read: false,
      readAt: null,
      rideId,
      requestId,
    });
    expect(result.id).toBeTruthy();
    expect(result.createdAt).toBeInstanceOf(Date);

    // No raw Prisma field leaks into the application result.
    expect(result).not.toHaveProperty('userId');

    const persisted = await prisma.notification.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(persisted.userId).toBe(recipient.id);
    expect(persisted.type).toBe(NotificationType.RIDE_REQUESTED);
  });

  it('stores NULL for absent ride/request context and passes through overrides', async () => {
    const recipient = await createUser('recipient-override');

    const result = await createNotification({
      recipientId: recipient.id,
      type: NotificationType.RIDE_CANCELLED,
      title: 'Custom title',
      body: 'Custom body',
    });
    cleanup.notificationIds.push(result.id);

    expect(result).toMatchObject({
      title: 'Custom title',
      body: 'Custom body',
      rideId: null,
      requestId: null,
    });
    const persisted = await prisma.notification.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(persisted.rideId).toBeNull();
    expect(persisted.requestId).toBeNull();
  });

  it('rejects a missing recipient with NotFoundError and persists nothing', async () => {
    const marker = `should-not-persist-${RUN_ID}`;
    await expect(
      createNotification({
        recipientId: `nonexistent-${unique('user')}`,
        type: NotificationType.RIDE_CONFIRMED,
        title: marker,
        body: 'nope',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const count = await prisma.notification.count({
      where: { title: marker },
    });
    expect(count).toBe(0);
  });

  it('never persists a notification when the insert FK fails (recipient vanished mid-flight)', async () => {
    const marker = `should-not-persist-fk-${RUN_ID}`;
    await expect(
      prisma.$transaction(async (tx) => {
        await persistNotification(tx, {
          userId: `nonexistent-${unique('user')}`,
          type: NotificationType.RIDE_CONFIRMED,
          title: marker,
          body: 'nope',
        });
      }),
    ).rejects.toThrow();
    const count = await prisma.notification.count({
      where: { title: marker },
    });
    expect(count).toBe(0);
  });
});

describe('listNotifications — real database integration', () => {
  it('lists a recipient newest first with an unread count and hasMore', async () => {
    const recipient = await createUser('list-owner');

    // Distinct createdAt values make the ordering assertion unambiguous.
    const base = Date.now() - 60_000;
    const older = await persistFixture(
      {
        userId: recipient.id,
        type: NotificationType.RIDE_CONFIRMED,
        title: 'older',
        body: 'older body',
      },
      new Date(base),
    );
    const newest = await persistFixture(
      {
        userId: recipient.id,
        type: NotificationType.RIDE_CANCELLED,
        title: 'newest',
        body: 'newest body',
      },
      new Date(base + 10_000),
    );
    const middle = await persistFixture(
      {
        userId: recipient.id,
        type: NotificationType.RIDE_EXPIRED,
        title: 'middle',
        body: 'middle body',
      },
      new Date(base + 5_000),
    );

    const result = await listNotifications({ userId: recipient.id });

    expect(result.notifications.map((n) => n.id)).toEqual([
      newest.id,
      middle.id,
      older.id,
    ]);
    expect(result.notifications[0]!.title).toBe('newest');
    expect(result.unreadCount).toBe(3);
    expect(result.hasMore).toBe(false);
  });

  it('reports hasMore and trims to the requested limit', async () => {
    const recipient = await createUser('list-limited');
    for (let i = 0; i < 5; i += 1) {
      await persistFixture({
        userId: recipient.id,
        type: NotificationType.RIDE_CONFIRMED,
        title: `n${i}`,
        body: `body ${i}`,
      });
    }

    const result = await listNotifications({ userId: recipient.id, limit: 2 });

    expect(result.notifications).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it('isolates recipients: a user only ever sees their own notifications', async () => {
    const owner = await createUser('isolation-owner');
    const other = await createUser('isolation-other');

    const owned = await persistFixture({
      userId: owner.id,
      type: NotificationType.RIDE_CONFIRMED,
      title: 'owned',
      body: 'owned body',
    });
    await persistFixture({
      userId: other.id,
      type: NotificationType.RIDE_CONFIRMED,
      title: 'other',
      body: 'other body',
    });

    const result = await listNotifications({ userId: owner.id });

    expect(result.notifications.map((n) => n.id)).toEqual([owned.id]);
    expect(result.notifications[0]!.title).toBe('owned');
  });

  it('counts only unread notifications in unreadCount', async () => {
    const recipient = await createUser('unread-count');
    const read = await persistFixture({
      userId: recipient.id,
      type: NotificationType.RIDE_CONFIRMED,
      title: 'read',
      body: 'read body',
    });
    await persistFixture({
      userId: recipient.id,
      type: NotificationType.RIDE_EXPIRED,
      title: 'unread',
      body: 'unread body',
    });

    await markNotificationAsRead({
      notificationId: read.id,
      userId: recipient.id,
    });

    const result = await listNotifications({ userId: recipient.id });
    expect(result.unreadCount).toBe(1);
  });
});

describe('markNotificationAsRead — real database integration', () => {
  it('marks an unread notification read and is idempotent on repeat', async () => {
    const recipient = await createUser('mark-one');
    const notification = await persistFixture({
      userId: recipient.id,
      type: NotificationType.RIDE_CONFIRMED,
      title: 'Ride confirmed',
      body: 'Your ride is confirmed',
    });

    const first = await markNotificationAsRead({
      notificationId: notification.id,
      userId: recipient.id,
    });
    expect(first.read).toBe(true);
    expect(first.readAt).toBeInstanceOf(Date);
    const firstReadAt = first.readAt;

    // Idempotent: the second call returns the state without touching readAt.
    const second = await markNotificationAsRead({
      notificationId: notification.id,
      userId: recipient.id,
    });
    expect(second.read).toBe(true);
    expect(second.readAt).toEqual(firstReadAt);

    const persisted = await prisma.notification.findUniqueOrThrow({
      where: { id: notification.id },
    });
    expect(persisted.readAt).toEqual(firstReadAt);
  });

  it('does not allow one user to mark another user notification read', async () => {
    const owner = await createUser('mark-owner');
    const stranger = await createUser('mark-stranger');
    const notification = await persistFixture({
      userId: owner.id,
      type: NotificationType.RIDE_CONFIRMED,
      title: 'Ride confirmed',
      body: 'Your ride is confirmed',
    });

    await expect(
      markNotificationAsRead({
        notificationId: notification.id,
        userId: stranger.id,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const persisted = await prisma.notification.findUniqueOrThrow({
      where: { id: notification.id },
    });
    expect(persisted.readAt).toBeNull();
  });
});

describe('markAllNotificationsAsRead — real database integration', () => {
  it('marks only the recipient unread notifications read and returns the count', async () => {
    const recipient = await createUser('mark-all');
    const other = await createUser('mark-all-other');

    const n1 = await persistFixture({
      userId: recipient.id,
      type: NotificationType.RIDE_CONFIRMED,
      title: 'a',
      body: 'a body',
    });
    const n2 = await persistFixture({
      userId: recipient.id,
      type: NotificationType.RIDE_EXPIRED,
      title: 'b',
      body: 'b body',
    });
    await persistFixture({
      userId: other.id,
      type: NotificationType.RIDE_CONFIRMED,
      title: 'c',
      body: 'c body',
    });

    const result = await markAllNotificationsAsRead({
      userId: recipient.id,
    });
    expect(result.updatedCount).toBe(2);

    const recipientUnread = await prisma.notification.count({
      where: { userId: recipient.id, readAt: null },
    });
    expect(recipientUnread).toBe(0);
    // Another recipient is untouched.
    const otherUnread = await prisma.notification.count({
      where: { userId: other.id, readAt: null },
    });
    expect(otherUnread).toBe(1);

    // Idempotent: nothing left unread → 0.
    const again = await markAllNotificationsAsRead({
      userId: recipient.id,
    });
    expect(again.updatedCount).toBe(0);

    // Read notifications keep their original readAt (never rewritten).
    const persisted = await prisma.notification.findMany({
      where: { id: { in: [n1.id, n2.id] } },
    });
    for (const row of persisted) {
      expect(row.readAt).not.toBeNull();
    }
  });
});

describe('notification transaction rollback — real database', () => {
  it('a notification inserted inside a failing transaction is rolled back', async () => {
    const recipient = await createUser('rollback');
    const marker = `rollback-${RUN_ID}`;

    await expect(
      prisma.$transaction(async (tx) => {
        await persistNotification(tx, {
          userId: recipient.id,
          type: NotificationType.RIDE_CONFIRMED,
          title: marker,
          body: 'nope',
        });
        throw new Error('boom after notification insert');
      }),
    ).rejects.toThrow('boom after notification insert');

    const count = await prisma.notification.count({
      where: { userId: recipient.id, title: marker },
    });
    expect(count).toBe(0);
  });
});
