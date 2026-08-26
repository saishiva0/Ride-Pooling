/**
 * Phase 3.8 Ride Engine → notification integration tests (real database).
 *
 * Verifies the six documented event → notification flows end-to-end against
 * the real PostgreSQL database, using the real Phase 3.5/3.6/3.7 use cases:
 *
 *   A. request created   → RIDE_REQUESTED    → the ride creator
 *   B. request accepted  → REQUEST_ACCEPTED  → the requester
 *   C. request rejected  → REQUEST_REJECTED  → the requester
 *   D. ride cancelled    → RIDE_CANCELLED    → creator + confirmed participants
 *   E. ride expired      → RIDE_EXPIRED      → creator (+ confirmed participants)
 *   F. first accept      → RIDE_CONFIRMED    → creator + confirmed requester
 *
 * Also verifies transactional consistency: a notification is only persisted
 * when the Ride Engine operation that produced it succeeds, and rolls back
 * with the operation on failure (no notification for a failed operation).
 *
 * Requires a reachable dev database with the Phase 2 migration applied.
 * Fixtures follow the existing conventions (RUN_ID prefixes, Hyderabad base
 * coordinates, cleanup in `afterAll`).
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { NotificationType, PricingType, RideStatus } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { createRideRequest } from '../../ride/application/create-ride-request.js';
import { acceptRideRequest } from '../../ride/application/accept-ride-request.js';
import { rejectRideRequest } from '../../ride/application/reject-ride-request.js';
import { cancelRide } from '../../ride/application/cancel-ride.js';
import { expireRide } from '../../ride/application/expire-ride.js';
import {
  setPushNotificationDispatcher,
  resetPushNotificationDispatcher,
} from '../../realtime/application/push-publisher.js';

const RUN_ID = `ridenotiftest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let seq = 0;
function unique(label: string): string {
  seq += 1;
  return `${RUN_ID}_${label}_${seq}`;
}

const cleanup = {
  participantIds: [] as string[],
  requestIds: [] as string[],
  rideIds: [] as string[],
  locationIds: [] as string[],
  userIds: [] as string[],
};

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { userId: { in: cleanup.userIds } },
  });
  await prisma.rideParticipant.deleteMany({
    where: { id: { in: cleanup.participantIds } },
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

async function createRideFixture(
  creatorId: string,
  options: { status?: RideStatus; totalSeats?: number } = {},
) {
  // Hyderabad base — same isolation convention as the Phase 3.6/3.7 fixtures.
  const pickup = await createLocation(17.385, 78.4867);
  const destination = await createLocation(17.4399, 78.4983);
  const ride = await prisma.ride.create({
    data: {
      creatorId,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
      departureDateTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      totalSeats: options.totalSeats ?? 3,
      vehicleType: unique('vehicle'),
      pricingType: PricingType.STANDARD,
      pricePerKm: 4,
      status: options.status ?? RideStatus.PUBLISHED,
    },
  });
  cleanup.rideIds.push(ride.id);
  return ride;
}

async function notificationsFor(
  userId: string,
  type: NotificationType,
): Promise<
  Array<{
    id: string;
    userId: string;
    rideId: string | null;
    requestId: string | null;
    title: string | null;
  }>
> {
  return prisma.notification.findMany({
    where: { userId, type },
    select: {
      id: true,
      userId: true,
      rideId: true,
      requestId: true,
      title: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

async function requestNotifications(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId } });
}

describe('Flow A — request created → RIDE_REQUESTED to the ride creator', () => {
  it('notifies only the creator, with ride and request context, in the same transaction', async () => {
    const creator = await createUser('flowA-creator');
    const requester = await createUser('flowA-requester');
    const ride = await createRideFixture(creator.id);

    const request = await createRideRequest({
      rideId: ride.id,
      requesterId: requester.id,
      requestedSeats: 1,
    });
    cleanup.requestIds.push(request.id);

    const notifications = await notificationsFor(
      creator.id,
      NotificationType.RIDE_REQUESTED,
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      rideId: ride.id,
      requestId: request.id,
      title: 'New ride request',
    });

    // The requester never notifies themselves.
    expect(await requestNotifications(requester.id)).toBe(0);
  });
});

describe('Flow B — request accepted → REQUEST_ACCEPTED to the requester', () => {
  it('notifies the requester when the creator accepts', async () => {
    const creator = await createUser('flowB-creator');
    const requester = await createUser('flowB-requester');
    const ride = await createRideFixture(creator.id);
    const request = await createRideRequest({
      rideId: ride.id,
      requesterId: requester.id,
    });
    cleanup.requestIds.push(request.id);

    const accepted = await acceptRideRequest({
      requestId: request.id,
      actorId: creator.id,
    });
    cleanup.participantIds.push(accepted.participantId);

    const notifications = await notificationsFor(
      requester.id,
      NotificationType.REQUEST_ACCEPTED,
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      rideId: ride.id,
      requestId: request.id,
      title: 'Ride request accepted',
    });
  });
});

describe('Flow C — request rejected → REQUEST_REJECTED to the requester', () => {
  it('notifies the requester when the creator rejects', async () => {
    const creator = await createUser('flowC-creator');
    const requester = await createUser('flowC-requester');
    const ride = await createRideFixture(creator.id);
    const request = await createRideRequest({
      rideId: ride.id,
      requesterId: requester.id,
    });
    cleanup.requestIds.push(request.id);

    await rejectRideRequest({ requestId: request.id, actorId: creator.id });

    const notifications = await notificationsFor(
      requester.id,
      NotificationType.REQUEST_REJECTED,
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      rideId: ride.id,
      requestId: request.id,
      title: 'Ride request rejected',
    });
  });
});

describe('Flow D — ride cancelled → RIDE_CANCELLED to creator + confirmed participants', () => {
  it('notifies the creator and every confirmed participant when the ride is cancelled', async () => {
    const creator = await createUser('flowD-creator');
    const first = await createUser('flowD-first');
    const second = await createUser('flowD-second');
    const ride = await createRideFixture(creator.id, { totalSeats: 4 });

    const r1 = await createRideRequest({
      rideId: ride.id,
      requesterId: first.id,
    });
    cleanup.requestIds.push(r1.id);
    const a1 = await acceptRideRequest({
      requestId: r1.id,
      actorId: creator.id,
    });
    cleanup.participantIds.push(a1.participantId);

    const r2 = await createRideRequest({
      rideId: ride.id,
      requesterId: second.id,
    });
    cleanup.requestIds.push(r2.id);
    const a2 = await acceptRideRequest({
      requestId: r2.id,
      actorId: creator.id,
    });
    cleanup.participantIds.push(a2.participantId);

    await cancelRide({ rideId: ride.id, actorId: creator.id });

    const creatorCancelled = await notificationsFor(
      creator.id,
      NotificationType.RIDE_CANCELLED,
    );
    const firstCancelled = await notificationsFor(
      first.id,
      NotificationType.RIDE_CANCELLED,
    );
    const secondCancelled = await notificationsFor(
      second.id,
      NotificationType.RIDE_CANCELLED,
    );

    expect(creatorCancelled).toHaveLength(1);
    expect(firstCancelled).toHaveLength(1);
    expect(secondCancelled).toHaveLength(1);
    for (const list of [creatorCancelled, firstCancelled, secondCancelled]) {
      expect(list[0]).toMatchObject({
        rideId: ride.id,
        title: 'Ride cancelled',
      });
    }
  });

  it('does not notify a requester whose request was never accepted (not a participant)', async () => {
    const creator = await createUser('flowD2-creator');
    const requester = await createUser('flowD2-requester');
    const ride = await createRideFixture(creator.id);
    const request = await createRideRequest({
      rideId: ride.id,
      requesterId: requester.id,
    });
    cleanup.requestIds.push(request.id);

    await cancelRide({ rideId: ride.id, actorId: creator.id });

    expect(
      await notificationsFor(requester.id, NotificationType.RIDE_CANCELLED),
    ).toHaveLength(0);
  });
});

describe('Flow E — ride expired → RIDE_EXPIRED to the creator', () => {
  it('notifies the creator when an eligible PUBLISHED ride expires', async () => {
    const creator = await createUser('flowE-creator');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });
    // Departure in the past, reference time after departure.
    const departure = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.ride.update({
      where: { id: ride.id },
      data: { departureDateTime: departure },
    });

    const result = await expireRide({
      rideId: ride.id,
      referenceTime: new Date(Date.now()),
    });
    expect(result.statusChanged).toBe(true);

    const notifications = await notificationsFor(
      creator.id,
      NotificationType.RIDE_EXPIRED,
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      rideId: ride.id,
      title: 'Ride expired',
    });
  });

  it('writes no notification when expiration is a no-op (ineligible ride)', async () => {
    const creator = await createUser('flowE2-creator');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });
    // Future departure → not expirable at reference time.
    const departure = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.ride.update({
      where: { id: ride.id },
      data: { departureDateTime: departure },
    });

    const result = await expireRide({
      rideId: ride.id,
      referenceTime: new Date(Date.now()),
    });
    expect(result.statusChanged).toBe(false);

    expect(
      await notificationsFor(creator.id, NotificationType.RIDE_EXPIRED),
    ).toHaveLength(0);
  });
});

describe('Flow F — first accept → RIDE_CONFIRMED to creator + confirmed requester', () => {
  it('notifies the creator and the confirmed requester when PUBLISHED → CONFIRMED', async () => {
    const creator = await createUser('flowF-creator');
    const requester = await createUser('flowF-requester');
    const ride = await createRideFixture(creator.id);
    const request = await createRideRequest({
      rideId: ride.id,
      requesterId: requester.id,
    });
    cleanup.requestIds.push(request.id);

    const accepted = await acceptRideRequest({
      requestId: request.id,
      actorId: creator.id,
    });
    cleanup.participantIds.push(accepted.participantId);
    expect(accepted.rideStatusChanged).toBe(true);

    const creatorConfirmed = await notificationsFor(
      creator.id,
      NotificationType.RIDE_CONFIRMED,
    );
    const requesterConfirmed = await notificationsFor(
      requester.id,
      NotificationType.RIDE_CONFIRMED,
    );

    expect(creatorConfirmed).toHaveLength(1);
    expect(requesterConfirmed).toHaveLength(1);
    for (const list of [creatorConfirmed, requesterConfirmed]) {
      expect(list[0]).toMatchObject({
        rideId: ride.id,
        title: 'Ride confirmed',
      });
    }
  });

  it('does not emit RIDE_CONFIRMED on a subsequent acceptance (ride already CONFIRMED)', async () => {
    const creator = await createUser('flowF2-creator');
    const first = await createUser('flowF2-first');
    const second = await createUser('flowF2-second');
    const ride = await createRideFixture(creator.id, { totalSeats: 4 });

    const r1 = await createRideRequest({
      rideId: ride.id,
      requesterId: first.id,
    });
    cleanup.requestIds.push(r1.id);
    const a1 = await acceptRideRequest({
      requestId: r1.id,
      actorId: creator.id,
    });
    cleanup.participantIds.push(a1.participantId);

    const r2 = await createRideRequest({
      rideId: ride.id,
      requesterId: second.id,
    });
    cleanup.requestIds.push(r2.id);
    const a2 = await acceptRideRequest({
      requestId: r2.id,
      actorId: creator.id,
    });
    cleanup.participantIds.push(a2.participantId);
    expect(a2.rideStatusChanged).toBe(false);

    // Exactly one RIDE_CONFIRMED notification per recipient (the first accept).
    expect(
      await notificationsFor(first.id, NotificationType.RIDE_CONFIRMED),
    ).toHaveLength(1);
    expect(
      await notificationsFor(second.id, NotificationType.RIDE_CONFIRMED),
    ).toHaveLength(0);
    expect(
      await notificationsFor(creator.id, NotificationType.RIDE_CONFIRMED),
    ).toHaveLength(1);
  });
});

describe('No notification for a failed Ride Engine operation (transactional consistency)', () => {
  it('a rejected acceptance (insufficient seats) persists no request/ride notifications', async () => {
    const creator = await createUser('noop-creator');
    const requester = await createUser('noop-requester');
    const occupier = await createUser('noop-occupier');
    const ride = await createRideFixture(creator.id, { totalSeats: 1 });

    // Both requests are created while the single seat is free; accepting the
    // first fills it, so accepting the second must fail (422).
    const request = await createRideRequest({
      rideId: ride.id,
      requesterId: requester.id,
      requestedSeats: 1,
    });
    cleanup.requestIds.push(request.id);

    const second = await createRideRequest({
      rideId: ride.id,
      requesterId: occupier.id,
    });
    cleanup.requestIds.push(second.id);

    const accepted = await acceptRideRequest({
      requestId: request.id,
      actorId: creator.id,
    });
    cleanup.participantIds.push(accepted.participantId);

    await expect(
      acceptRideRequest({ requestId: second.id, actorId: creator.id }),
    ).rejects.toMatchObject({ statusCode: 422 });

    // The failed acceptance wrote nothing for the occupier: no participant
    // and no REQUEST_ACCEPTED / RIDE_CONFIRMED notification.
    expect(
      await notificationsFor(occupier.id, NotificationType.REQUEST_ACCEPTED),
    ).toHaveLength(0);
    expect(
      await notificationsFor(occupier.id, NotificationType.RIDE_CONFIRMED),
    ).toHaveLength(0);
    expect(
      await notificationsFor(occupier.id, NotificationType.RIDE_EXPIRED),
    ).toHaveLength(0);
  });

  it('a duplicate active request creates no duplicate RIDE_REQUESTED notification', async () => {
    const creator = await createUser('dup-creator');
    const requester = await createUser('dup-requester');
    const ride = await createRideFixture(creator.id);

    const first = await createRideRequest({
      rideId: ride.id,
      requesterId: requester.id,
    });
    cleanup.requestIds.push(first.id);

    await expect(
      createRideRequest({ rideId: ride.id, requesterId: requester.id }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(
      await notificationsFor(creator.id, NotificationType.RIDE_REQUESTED),
    ).toHaveLength(1);
  });
});

describe('Push dispatch failure never breaks the ride/request operation (Phase 3.23)', () => {
  afterAll(() => {
    resetPushNotificationDispatcher();
  });

  it('accept still succeeds and the notification persists when the push dispatcher rejects', async () => {
    setPushNotificationDispatcher({
      dispatch: async () => {
        throw new Error('Expo unavailable');
      },
    });

    const creator = await createUser('pushfail-creator');
    const requester = await createUser('pushfail-requester');
    const ride = await createRideFixture(creator.id);
    const request = await createRideRequest({
      rideId: ride.id,
      requesterId: requester.id,
    });
    cleanup.requestIds.push(request.id);

    const accepted = await acceptRideRequest({
      requestId: request.id,
      actorId: creator.id,
    });
    cleanup.participantIds.push(accepted.participantId);

    // The business operation succeeded despite the push dispatcher throwing.
    expect(accepted.rideStatusChanged).toBe(true);

    // The persisted notification (the source of truth) still exists.
    const notifications = await notificationsFor(
      requester.id,
      NotificationType.REQUEST_ACCEPTED,
    );
    expect(notifications).toHaveLength(1);
  });
});
