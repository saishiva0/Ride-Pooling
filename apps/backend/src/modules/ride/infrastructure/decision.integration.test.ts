/**
 * Phase 3.6 real-database / integration tests for request acceptance and
 * rejection.
 *
 * Exercises `acceptRideRequest` / `rejectRideRequest` end-to-end against the
 * real PostgreSQL database: participant persistence, request status updates,
 * ride status transition + `RideStatusHistory` on first accept, rejection
 * creating no participant, insufficient seats leaving no partial mutation,
 * creator-only decisions, duplicate participant protection (app + DB), and
 * subsequent-accept / historical-reject behaviour. Also proves a genuine
 * mid-transaction rollback when a write fails after participant creation.
 *
 * Requires a reachable dev database with the Phase 2 migration applied.
 * Fixtures follow the existing conventions: RUN_ID prefixes, cleanup in
 * `afterAll`.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ParticipantStatus,
  Prisma,
  PricingType,
  RideRequestStatus,
  RideStatus,
} from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
} from '../../../lib/errors.js';
import { createRideRequest } from '../application/create-ride-request.js';
import { acceptRideRequest } from '../application/accept-ride-request.js';
import { rejectRideRequest } from '../application/reject-ride-request.js';
import {
  classifyRideRequestError,
  persistRideParticipant,
  persistRideStatusHistory,
  updateRideRequestStatus,
  updateRideStatus,
} from './ride.repository.js';

const RUN_ID = `decitest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  await prisma.rideStatusHistory.deleteMany({
    where: { rideId: { in: cleanup.rideIds } },
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
  // Hyderabad base — deliberately far (>400 km) from the Bengaluru BASE
  // used by the Phase 3.3 discovery / Phase 3.4 matching integration
  // fixtures, so these rides can never compete for the discovery result
  // limit (`DEFAULT_DISCOVERY_LIMIT`) inside its 8 km search radius.
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
  return { ride, pickup, destination };
}

/** Creates a PENDING request through the real Phase 3.5 use case. */
async function createPendingRequest(
  rideId: string,
  requesterId: string,
  requestedSeats = 1,
) {
  const request = await createRideRequest({
    rideId,
    requesterId,
    requestedSeats,
  });
  cleanup.requestIds.push(request.id);
  return request;
}

/** Confirms a participant directly (setup helper for seat-pressure fixtures). */
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

async function confirmedSeats(rideId: string): Promise<number> {
  const result = await prisma.rideParticipant.aggregate({
    where: { rideId, status: 'CONFIRMED' },
    _sum: { seatsAllocated: true },
  });
  return result._sum.seatsAllocated ?? 0;
}

async function rideHistoryCount(rideId: string): Promise<number> {
  return prisma.rideStatusHistory.count({ where: { rideId } });
}

describe('acceptRideRequest — real database integration', () => {
  it('persists the participant, accepts the request, and confirms the ride with history', async () => {
    const creator = await createUser('creator-happy');
    const requester = await createUser('requester-happy');
    const { ride } = await createRideFixture(creator.id, { totalSeats: 4 });
    const request = await createPendingRequest(ride.id, requester.id, 2);

    const result = await acceptRideRequest({
      requestId: request.id,
      actorId: creator.id,
    });
    cleanup.participantIds.push(result.participantId);

    expect(result).toMatchObject({
      requestId: request.id,
      requestStatus: RideRequestStatus.ACCEPTED,
      rideId: ride.id,
      allocatedSeats: 2,
      participantStatus: ParticipantStatus.CONFIRMED,
      rideStatus: RideStatus.CONFIRMED,
      rideStatusChanged: true,
    });

    const participant = await prisma.rideParticipant.findUniqueOrThrow({
      where: { id: result.participantId },
    });
    expect(participant.rideId).toBe(ride.id);
    expect(participant.userId).toBe(requester.id);
    expect(participant.requestId).toBe(request.id);
    expect(participant.seatsAllocated).toBe(2);
    expect(participant.status).toBe(ParticipantStatus.CONFIRMED);

    const persisted = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(persisted.status).toBe(RideRequestStatus.ACCEPTED);
    expect(persisted.resolvedAt).not.toBeNull();

    const rideAfter = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(rideAfter.status).toBe(RideStatus.CONFIRMED);

    const history = await prisma.rideStatusHistory.findMany({
      where: { rideId: ride.id },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromStatus: RideStatus.PUBLISHED,
      toStatus: RideStatus.CONFIRMED,
      changedByUserId: creator.id,
      reason: 'First request accepted',
    });
    expect(await confirmedSeats(ride.id)).toBe(2);
  });

  it('accepting a second request keeps the ride CONFIRMED with no extra history', async () => {
    const creator = await createUser('creator-second');
    const first = await createUser('requester-second-1');
    const second = await createUser('requester-second-2');
    const { ride } = await createRideFixture(creator.id, { totalSeats: 3 });

    const r1 = await createPendingRequest(ride.id, first.id, 1);
    const a1 = await acceptRideRequest({
      requestId: r1.id,
      actorId: creator.id,
    });
    cleanup.participantIds.push(a1.participantId);

    const r2 = await createPendingRequest(ride.id, second.id, 1);
    const a2 = await acceptRideRequest({
      requestId: r2.id,
      actorId: creator.id,
    });
    cleanup.participantIds.push(a2.participantId);

    expect(a2.rideStatus).toBe(RideStatus.CONFIRMED);
    expect(a2.rideStatusChanged).toBe(false);
    expect(await confirmedSeats(ride.id)).toBe(2);
    expect(await rideHistoryCount(ride.id)).toBe(1);
    const r2After = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: r2.id },
    });
    expect(r2After.status).toBe(RideRequestStatus.ACCEPTED);
  });

  it('rejects acceptance by a non-creator actor and mutates nothing', async () => {
    const creator = await createUser('creator-wrongactor');
    const requester = await createUser('requester-wrongactor');
    const stranger = await createUser('stranger');
    const { ride } = await createRideFixture(creator.id);
    const request = await createPendingRequest(ride.id, requester.id);

    const promise = acceptRideRequest({
      requestId: request.id,
      actorId: stranger.id,
    });
    await expect(promise).rejects.toBeInstanceOf(AuthorizationError);
    await expect(promise).rejects.toMatchObject({ statusCode: 403 });

    const persisted = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(persisted.status).toBe(RideRequestStatus.PENDING);
    expect(await confirmedSeats(ride.id)).toBe(0);
    expect(await rideHistoryCount(ride.id)).toBe(0);
  });

  it('rejects acceptance of an already-accepted request (no double participant)', async () => {
    const creator = await createUser('creator-dup');
    const requester = await createUser('requester-dup');
    const { ride } = await createRideFixture(creator.id);
    const request = await createPendingRequest(ride.id, requester.id);

    const first = await acceptRideRequest({
      requestId: request.id,
      actorId: creator.id,
    });
    cleanup.participantIds.push(first.participantId);

    const promise = acceptRideRequest({
      requestId: request.id,
      actorId: creator.id,
    });
    await expect(promise).rejects.toBeInstanceOf(ConflictError);

    expect(
      await prisma.rideParticipant.count({ where: { requestId: request.id } }),
    ).toBe(1);
    expect(await confirmedSeats(ride.id)).toBe(1);
  });

  it('rejects when the requested seats exceed availability, leaving no partial mutation', async () => {
    const creator = await createUser('creator-noseats');
    const requester = await createUser('requester-noseats');
    const occupier = await createUser('occupier');
    const { ride } = await createRideFixture(creator.id, { totalSeats: 2 });

    // The request is created while 2 seats are free, then another
    // participant fills a seat before acceptance — a stale request
    // (`phase-3-6` §29: acceptance must re-check live availability).
    const request = await createPendingRequest(ride.id, requester.id, 2);
    await addConfirmedParticipant(ride.id, occupier.id, 1);

    const before = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });

    const promise = acceptRideRequest({
      requestId: request.id,
      actorId: creator.id,
    });
    await expect(promise).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(promise).rejects.toMatchObject({
      details: { requestedSeats: 2, availableSeats: 1, totalSeats: 2 },
    });

    const persisted = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(persisted.status).toBe(RideRequestStatus.PENDING);
    expect(persisted.resolvedAt).toBeNull();
    expect(
      await prisma.rideParticipant.count({ where: { requestId: request.id } }),
    ).toBe(0);
    const after = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(after.status).toBe(before.status);
    expect(after.totalSeats).toBe(before.totalSeats);
    expect(await confirmedSeats(ride.id)).toBe(1);
  });
});

describe('rejectRideRequest — real database integration', () => {
  it('rejects the request without creating a participant or changing the ride', async () => {
    const creator = await createUser('creator-reject');
    const requester = await createUser('requester-reject');
    const { ride } = await createRideFixture(creator.id);
    const request = await createPendingRequest(ride.id, requester.id, 2);

    const result = await rejectRideRequest({
      requestId: request.id,
      actorId: creator.id,
    });

    expect(result).toEqual({
      requestId: request.id,
      requestStatus: RideRequestStatus.REJECTED,
      rideId: ride.id,
    });

    const persisted = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(persisted.status).toBe(RideRequestStatus.REJECTED);
    expect(persisted.resolvedAt).not.toBeNull();
    expect(
      await prisma.rideParticipant.count({ where: { requestId: request.id } }),
    ).toBe(0);
    const rideAfter = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(rideAfter.status).toBe(RideStatus.PUBLISHED);
    expect(await confirmedSeats(ride.id)).toBe(0);
    expect(await rideHistoryCount(ride.id)).toBe(0);
  });

  it('rejects rejection by a non-creator actor', async () => {
    const creator = await createUser('creator-reject-actor');
    const requester = await createUser('requester-reject-actor');
    const stranger = await createUser('stranger-reject-actor');
    const { ride } = await createRideFixture(creator.id);
    const request = await createPendingRequest(ride.id, requester.id);

    const promise = rejectRideRequest({
      requestId: request.id,
      actorId: stranger.id,
    });
    await expect(promise).rejects.toBeInstanceOf(AuthorizationError);

    const persisted = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(persisted.status).toBe(RideRequestStatus.PENDING);
  });

  it('rejects rejection of an already-terminal request', async () => {
    const creator = await createUser('creator-reject-term');
    const requester = await createUser('requester-reject-term');
    const { ride } = await createRideFixture(creator.id);
    const request = await createPendingRequest(ride.id, requester.id);

    const first = await acceptRideRequest({
      requestId: request.id,
      actorId: creator.id,
    });
    cleanup.participantIds.push(first.participantId);

    const promise = rejectRideRequest({
      requestId: request.id,
      actorId: creator.id,
    });
    await expect(promise).rejects.toBeInstanceOf(ConflictError);

    const persisted = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(persisted.status).toBe(RideRequestStatus.ACCEPTED);
  });

  it('allows a new request after a historical REJECTED one', async () => {
    const creator = await createUser('creator-historical');
    const requester = await createUser('requester-historical');
    const { ride } = await createRideFixture(creator.id);

    const first = await createPendingRequest(ride.id, requester.id);
    await rejectRideRequest({ requestId: first.id, actorId: creator.id });

    const second = await createPendingRequest(ride.id, requester.id);
    expect(second.status).toBe(RideRequestStatus.PENDING);
    const accepted = await acceptRideRequest({
      requestId: second.id,
      actorId: creator.id,
    });
    cleanup.participantIds.push(accepted.participantId);
    expect(accepted.requestStatus).toBe(RideRequestStatus.ACCEPTED);
  });
});

describe('duplicate participant protection — database constraints remain effective', () => {
  it('the requestId unique index rejects a second participant and classifyError maps it', async () => {
    const creator = await createUser('creator-dupe-db');
    const requester = await createUser('requester-dupe-db');
    const { ride } = await createRideFixture(creator.id);
    const request = await createPendingRequest(ride.id, requester.id);

    const accepted = await acceptRideRequest({
      requestId: request.id,
      actorId: creator.id,
    });
    cleanup.participantIds.push(accepted.participantId);

    let rawErr: unknown;
    try {
      await prisma.rideParticipant.create({
        data: {
          rideId: ride.id,
          userId: requester.id,
          requestId: request.id,
          seatsAllocated: 1,
          status: 'CONFIRMED',
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

    expect(
      await prisma.rideParticipant.count({ where: { rideId: ride.id } }),
    ).toBe(1);
    expect(await confirmedSeats(ride.id)).toBe(1);
  });
});

describe('acceptance rollback — no partial mutation on mid-transaction failure', () => {
  it('rolls back participant, request, ride status, and history when a later write fails', async () => {
    const creator = await createUser('creator-rollback');
    const requester = await createUser('requester-rollback');
    const { ride } = await createRideFixture(creator.id, { totalSeats: 3 });
    const request = await createPendingRequest(ride.id, requester.id);

    // Replicates the acceptance transaction using the production repository
    // functions, then forces a genuine Postgres FK failure (invalid
    // changedByUserId on the status-history insert) AFTER the participant and
    // request writes have already succeeded inside the transaction. No
    // production constraint is weakened to make this fail.
    await expect(
      prisma.$transaction(async (tx) => {
        await persistRideParticipant(tx, {
          rideId: ride.id,
          userId: requester.id,
          requestId: request.id,
          seatsAllocated: 1,
          status: ParticipantStatus.CONFIRMED,
        });
        await updateRideRequestStatus(tx, {
          requestId: request.id,
          status: RideRequestStatus.ACCEPTED,
          resolvedAt: new Date(),
        });
        await updateRideStatus(tx, {
          rideId: ride.id,
          status: RideStatus.CONFIRMED,
        });
        await persistRideStatusHistory(tx, {
          rideId: ride.id,
          fromStatus: RideStatus.PUBLISHED,
          toStatus: RideStatus.CONFIRMED,
          changedByUserId: `nonexistent-${unique('user')}`,
          reason: 'First request accepted',
        });
      }),
    ).rejects.toThrow();

    const persisted = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(persisted.status).toBe(RideRequestStatus.PENDING);
    expect(persisted.resolvedAt).toBeNull();
    expect(
      await prisma.rideParticipant.count({ where: { requestId: request.id } }),
    ).toBe(0);
    const rideAfter = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(rideAfter.status).toBe(RideStatus.PUBLISHED);
    expect(await rideHistoryCount(ride.id)).toBe(0);
    expect(await confirmedSeats(ride.id)).toBe(0);
  });
});
