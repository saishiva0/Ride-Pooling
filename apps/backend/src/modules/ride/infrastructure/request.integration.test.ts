/**
 * Phase 3.5 real-database / integration tests for Ride Request creation.
 *
 * Exercises the `createRideRequest` use case end-to-end against the real
 * PostgreSQL database: persistence + relationships, the initial `PENDING`
 * status, business rules (self-request, requestable states, seats, duplicate
 * active request), the database partial unique index as the final
 * protection, FK integrity, no-partial-data guarantees, read-only behaviour
 * toward Ride/Participant data, and a genuine concurrent duplicate-request
 * race.
 *
 * Requires a reachable dev database with the Phase 2 migration applied.
 * Fixtures follow the existing conventions: RUN_ID prefixes, cleanup in
 * `afterAll`.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import {
  Prisma,
  PricingType,
  RideRequestStatus,
  RideStatus,
} from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../../lib/errors.js';
import { createRideRequest } from '../application/create-ride-request.js';
import {
  classifyRideRequestError,
  persistRideRequest,
} from './ride.repository.js';

const RUN_ID = `reqtest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  await prisma.rideParticipant.deleteMany({
    where: { id: { in: cleanup.participantIds } },
  });
  await prisma.rideRequest.deleteMany({
    where: { id: { in: cleanup.requestIds } },
  });
  await prisma.ride.deleteMany({ where: { id: { in: cleanup.rideIds } } });
  await prisma.location.deleteMany({
    where: { id: { in: cleanup.locationIds } },
  });
  // Phase 3.8: notifications reference users with ON DELETE RESTRICT, so
  // they must be removed before the users that own them.
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

async function createRideFixture(
  creatorId: string,
  options: { status?: RideStatus; totalSeats?: number } = {},
) {
  const pickup = await createLocation(12.9716, 77.5946);
  const destination = await createLocation(12.2958, 76.6394);
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
  return { ride, pickup, destination };
}

/** Confirms a participant (ACCEPTED request + CONFIRMED participant). */
async function addConfirmedParticipant(
  rideId: string,
  userId: string,
  seats: number,
) {
  const request = await prisma.rideRequest.create({
    data: {
      rideId,
      userId,
      requestedSeats: seats,
      status: 'ACCEPTED',
      resolvedAt: new Date(),
    },
  });
  cleanup.requestIds.push(request.id);
  const participant = await prisma.rideParticipant.create({
    data: {
      rideId,
      userId,
      requestId: request.id,
      seatsAllocated: seats,
      status: 'CONFIRMED',
    },
  });
  cleanup.participantIds.push(participant.id);
}

async function requestCount(rideId: string, userId: string): Promise<number> {
  return prisma.rideRequest.count({ where: { rideId, userId } });
}

describe('createRideRequest — real database integration', () => {
  it('persists a PENDING request with the correct relationships', async () => {
    const creator = await createUser('creator');
    const requester = await createUser('requester');
    const { ride } = await createRideFixture(creator.id);

    const result = await createRideRequest({
      rideId: ride.id,
      requesterId: requester.id,
      requestedSeats: 2,
    });
    cleanup.requestIds.push(result.id);

    expect(result).toMatchObject({
      rideId: ride.id,
      requester: { id: requester.id, name: requester.name },
      requestedSeats: 2,
      status: RideRequestStatus.PENDING,
    });

    const persisted = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(persisted.rideId).toBe(ride.id);
    expect(persisted.userId).toBe(requester.id);
    expect(persisted.requestedSeats).toBe(2);
    expect(persisted.status).toBe(RideRequestStatus.PENDING);
    expect(persisted.resolvedAt).toBeNull();
  });

  it('rejects a missing requester and leaves no request behind', async () => {
    const creator = await createUser('creator-missing');
    const { ride } = await createRideFixture(creator.id);

    await expect(
      createRideRequest({
        rideId: ride.id,
        requesterId: `nonexistent-${unique('user')}`,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await requestCount(ride.id, `nonexistent-${unique('user')}`)).toBe(
      0,
    );
  });

  it('rejects a missing ride', async () => {
    const requester = await createUser('requester-missing-ride');

    await expect(
      createRideRequest({
        rideId: `nonexistent-${unique('ride')}`,
        requesterId: requester.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects the ride creator requesting their own ride', async () => {
    const creator = await createUser('creator-self');
    const { ride } = await createRideFixture(creator.id);

    await expect(
      createRideRequest({ rideId: ride.id, requesterId: creator.id }),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    expect(await requestCount(ride.id, creator.id)).toBe(0);
  });

  it('rejects requests for non-requestable ride states', async () => {
    const creator = await createUser('creator-state');
    const requester = await createUser('requester-state');

    for (const status of [
      RideStatus.DRAFT,
      RideStatus.IN_PROGRESS,
      RideStatus.COMPLETED,
      RideStatus.CANCELLED,
      RideStatus.EXPIRED,
    ]) {
      const { ride } = await createRideFixture(creator.id, { status });

      await expect(
        createRideRequest({ rideId: ride.id, requesterId: requester.id }),
      ).rejects.toBeInstanceOf(BusinessRuleError);
      expect(await requestCount(ride.id, requester.id)).toBe(0);
    }
  });

  it('rejects a request exceeding currently available seats', async () => {
    const creator = await createUser('creator-seats');
    const requester = await createUser('requester-seats');
    const other = await createUser('requester-seats-other');
    const { ride } = await createRideFixture(creator.id, { totalSeats: 2 });
    await addConfirmedParticipant(ride.id, other.id, 1);

    await expect(
      createRideRequest({
        rideId: ride.id,
        requesterId: requester.id,
        requestedSeats: 2,
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(await requestCount(ride.id, requester.id)).toBe(0);

    const ok = await createRideRequest({
      rideId: ride.id,
      requesterId: requester.id,
      requestedSeats: 1,
    });
    cleanup.requestIds.push(ok.id);
  });

  it('rejects a duplicate active request and the DB constraint remains effective', async () => {
    const creator = await createUser('creator-dupe');
    const requester = await createUser('requester-dupe');
    const { ride } = await createRideFixture(creator.id);

    const first = await createRideRequest({
      rideId: ride.id,
      requesterId: requester.id,
    });
    cleanup.requestIds.push(first.id);

    await expect(
      createRideRequest({ rideId: ride.id, requesterId: requester.id }),
    ).rejects.toBeInstanceOf(ConflictError);

    // The partial unique index is the final protection: a direct second
    // insert with an active status must fail at the database level.
    let rawErr: unknown;
    try {
      await prisma.rideRequest.create({
        data: {
          rideId: ride.id,
          userId: requester.id,
          requestedSeats: 1,
          status: 'PENDING',
        },
      });
    } catch (err) {
      rawErr = err;
    }
    expect(
      rawErr instanceof Prisma.PrismaClientKnownRequestError &&
        rawErr.code === 'P2002',
    ).toBe(true);
    expect(classifyRideRequestError(rawErr)).toBe('unique');

    expect(await requestCount(ride.id, requester.id)).toBe(1);
  });

  it('allows a new request after a historical (REJECTED) request', async () => {
    const creator = await createUser('creator-historical');
    const requester = await createUser('requester-historical');
    const { ride } = await createRideFixture(creator.id);

    const first = await createRideRequest({
      rideId: ride.id,
      requesterId: requester.id,
    });
    cleanup.requestIds.push(first.id);
    await prisma.rideRequest.update({
      where: { id: first.id },
      data: { status: 'REJECTED', resolvedAt: new Date() },
    });

    const second = await createRideRequest({
      rideId: ride.id,
      requesterId: requester.id,
    });
    cleanup.requestIds.push(second.id);
    expect(second.status).toBe(RideRequestStatus.PENDING);
  });

  it('classifies foreign-key violations for a vanished ride', async () => {
    const requester = await createUser('requester-fk');
    let caught: unknown;
    try {
      await prisma.$transaction(async (tx) => {
        await persistRideRequest(tx, {
          rideId: `nonexistent-${unique('ride')}`,
          userId: requester.id,
          requestedSeats: 1,
          status: RideRequestStatus.PENDING,
        });
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(classifyRideRequestError(caught)).toBe('foreign_key');
  });

  it('leaves Ride and Participant data intact (read-only request creation)', async () => {
    const creator = await createUser('creator-readonly');
    const requester = await createUser('requester-readonly');
    const participantUser = await createUser('requester-readonly-p');
    const { ride } = await createRideFixture(creator.id, { totalSeats: 4 });
    await addConfirmedParticipant(ride.id, participantUser.id, 1);

    const beforeParticipants = await prisma.rideParticipant.count({
      where: { rideId: ride.id },
    });
    const beforeRide = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });

    const result = await createRideRequest({
      rideId: ride.id,
      requesterId: requester.id,
    });
    cleanup.requestIds.push(result.id);

    const afterParticipants = await prisma.rideParticipant.count({
      where: { rideId: ride.id },
    });
    const afterRide = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });

    expect(afterParticipants).toBe(beforeParticipants);
    expect(afterRide.status).toBe(beforeRide.status);
    expect(afterRide.totalSeats).toBe(beforeRide.totalSeats);
  });

  it('concurrent duplicate requests: exactly one succeeds, the other is rejected', async () => {
    const creator = await createUser('creator-race');
    const requester = await createUser('requester-race');
    const { ride } = await createRideFixture(creator.id);

    const attempts = await Promise.allSettled([
      createRideRequest({ rideId: ride.id, requesterId: requester.id }),
      createRideRequest({ rideId: ride.id, requesterId: requester.id }),
    ]);

    const fulfilled = attempts.filter((a) => a.status === 'fulfilled') as Array<
      PromiseFulfilledResult<{ id: string }>
    >;
    const rejected = attempts.filter(
      (a) => a.status === 'rejected',
    ) as Array<PromiseRejectedResult>;

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(ConflictError);

    cleanup.requestIds.push(fulfilled[0]!.value.id);
    expect(await requestCount(ride.id, requester.id)).toBe(1);
  });
});
