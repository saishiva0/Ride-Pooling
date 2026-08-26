/**
 * Phase 3.21 real-database / integration tests for request withdrawal and
 * participation cancellation.
 *
 * Exercises `cancelRideRequest` end-to-end against the real PostgreSQL
 * database: PENDING withdrawal (request → CANCELLED, ride untouched),
 * ACCEPTED participation cancellation (participant → CANCELLED with
 * cancelledAt, seat freed, request → CANCELLED), the last-participant
 * CONFIRMED → PUBLISHED revert with history, the IN_PROGRESS prohibition
 * (OD-011), owner-only authorization, already-resolved conflicts, and the
 * REQUEST_CANCELLED notification to the ride creator.
 *
 * Requires a reachable dev database with the Phase 2 migration applied.
 * Fixtures follow the existing conventions: RUN_ID prefixes, cleanup in
 * `afterAll`.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import {
  NotificationType,
  ParticipantStatus,
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
import { cancelRideRequest } from '../application/cancel-ride-request.js';

const RUN_ID = `reqcancel_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  // Notifications reference users with ON DELETE RESTRICT, so they must be
  // removed before the users that own them.
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

/** Accepts a request through the real Phase 3.6 use case. */
async function acceptRequest(
  requestId: string,
  creatorId: string,
): Promise<{ participantId: string }> {
  const result = await acceptRideRequest({
    requestId,
    actorId: creatorId,
  });
  cleanup.participantIds.push(result.participantId);
  return { participantId: result.participantId };
}

async function confirmedSeats(rideId: string): Promise<number> {
  const result = await prisma.rideParticipant.aggregate({
    where: { rideId, status: 'CONFIRMED' },
    _sum: { seatsAllocated: true },
  });
  return result._sum.seatsAllocated ?? 0;
}

async function cancelledNotifications(
  creatorId: string,
  requestId: string,
): Promise<number> {
  return prisma.notification.count({
    where: {
      userId: creatorId,
      type: NotificationType.REQUEST_CANCELLED,
      requestId,
    },
  });
}

describe('cancelRideRequest — PENDING withdrawal, real database', () => {
  it('cancels the request, leaves the ride PUBLISHED, and notifies the creator', async () => {
    const creator = await createUser('creator-withdraw');
    const requester = await createUser('requester-withdraw');
    const { ride } = await createRideFixture(creator.id, { totalSeats: 3 });
    const request = await createPendingRequest(ride.id, requester.id, 2);

    const result = await cancelRideRequest({
      requestId: request.id,
      actorId: requester.id,
    });

    expect(result).toMatchObject({
      requestId: request.id,
      requestStatus: RideRequestStatus.CANCELLED,
      rideId: ride.id,
      participantId: null,
      participantStatus: null,
      releasedSeats: 0,
      rideStatus: RideStatus.PUBLISHED,
      rideStatusChanged: false,
    });

    const persisted = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(persisted.status).toBe(RideRequestStatus.CANCELLED);
    expect(persisted.resolvedAt).not.toBeNull();

    const rideAfter = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(rideAfter.status).toBe(RideStatus.PUBLISHED);
    expect(await confirmedSeats(ride.id)).toBe(0);
    expect(
      await prisma.rideParticipant.count({ where: { requestId: request.id } }),
    ).toBe(0);
    expect(await cancelledNotifications(creator.id, request.id)).toBe(1);
  });

  it('allows a fresh request after a withdrawn one (CANCELLED is not active)', async () => {
    const creator = await createUser('creator-withdraw-again');
    const requester = await createUser('requester-withdraw-again');
    const { ride } = await createRideFixture(creator.id, { totalSeats: 3 });

    const first = await createPendingRequest(ride.id, requester.id);
    await cancelRideRequest({ requestId: first.id, actorId: requester.id });

    const second = await createPendingRequest(ride.id, requester.id);
    expect(second.status).toBe(RideRequestStatus.PENDING);

    const accepted = await acceptRequest(second.id, creator.id);
    expect(accepted.participantId).toBeTruthy();
  });
});

describe('cancelRideRequest — ACCEPTED participation, real database', () => {
  it('cancels the participation, frees the seats, and keeps the ride CONFIRMED', async () => {
    const creator = await createUser('creator-cancelpart');
    const first = await createUser('participant-cancelpart-1');
    const second = await createUser('participant-cancelpart-2');
    const { ride } = await createRideFixture(creator.id, { totalSeats: 4 });

    const r1 = await createPendingRequest(ride.id, first.id, 2);
    const r2 = await createPendingRequest(ride.id, second.id, 1);
    const a1 = await acceptRequest(r1.id, creator.id);
    await acceptRequest(r2.id, creator.id);
    expect(await confirmedSeats(ride.id)).toBe(3);

    const result = await cancelRideRequest({
      requestId: r1.id,
      actorId: first.id,
    });

    expect(result).toMatchObject({
      requestId: r1.id,
      requestStatus: RideRequestStatus.CANCELLED,
      participantId: a1.participantId,
      participantStatus: ParticipantStatus.CANCELLED,
      releasedSeats: 2,
      rideStatus: RideStatus.CONFIRMED,
      rideStatusChanged: false,
    });

    const participant = await prisma.rideParticipant.findUniqueOrThrow({
      where: { id: a1.participantId },
    });
    expect(participant.status).toBe(ParticipantStatus.CANCELLED);
    expect(participant.cancelledAt).not.toBeNull();

    const request = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: r1.id },
    });
    expect(request.status).toBe(RideRequestStatus.CANCELLED);
    expect(request.resolvedAt).not.toBeNull();

    // The 2 freed seats are available again; the other participant keeps 1.
    expect(await confirmedSeats(ride.id)).toBe(1);
    const rideAfter = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(rideAfter.status).toBe(RideStatus.CONFIRMED);
    expect(await cancelledNotifications(creator.id, r1.id)).toBe(1);
  });

  it('reverts CONFIRMED → PUBLISHED when the last participant cancels, with history', async () => {
    const creator = await createUser('creator-last');
    const requester = await createUser('participant-last');
    const { ride } = await createRideFixture(creator.id, { totalSeats: 3 });

    const request = await createPendingRequest(ride.id, requester.id, 2);
    const accepted = await acceptRequest(request.id, creator.id);
    expect(await confirmedSeats(ride.id)).toBe(2);

    const result = await cancelRideRequest({
      requestId: request.id,
      actorId: requester.id,
    });

    expect(result.rideStatus).toBe(RideStatus.PUBLISHED);
    expect(result.rideStatusChanged).toBe(true);

    const rideAfter = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(rideAfter.status).toBe(RideStatus.PUBLISHED);
    expect(await confirmedSeats(ride.id)).toBe(0);

    // Two transitions are recorded for this ride: the first accept
    // (PUBLISHED → CONFIRMED, Phase 3.6) and this revert
    // (CONFIRMED → PUBLISHED). Only the revert row is asserted here.
    const history = await prisma.rideStatusHistory.findMany({
      where: { rideId: ride.id },
    });
    expect(history).toHaveLength(2);

    const revertHistory = await prisma.rideStatusHistory.findMany({
      where: {
        rideId: ride.id,
        fromStatus: RideStatus.CONFIRMED,
        toStatus: RideStatus.PUBLISHED,
      },
    });
    expect(revertHistory).toHaveLength(1);
    expect(revertHistory[0]).toMatchObject({
      changedByUserId: requester.id,
      reason: 'Last confirmed participant cancelled',
    });
    expect(accepted.participantId).toBeTruthy();
    expect(await cancelledNotifications(creator.id, request.id)).toBe(1);
  });
});

describe('cancelRideRequest — authorization and state guards, real database', () => {
  it('rejects a non-owner actor (the creator) and mutates nothing', async () => {
    const creator = await createUser('creator-nonowner');
    const requester = await createUser('requester-nonowner');
    const { ride } = await createRideFixture(creator.id);
    const request = await createPendingRequest(ride.id, requester.id);

    const promise = cancelRideRequest({
      requestId: request.id,
      actorId: creator.id,
    });
    await expect(promise).rejects.toBeInstanceOf(AuthorizationError);
    await expect(promise).rejects.toMatchObject({ statusCode: 403 });

    const persisted = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(persisted.status).toBe(RideRequestStatus.PENDING);
    expect(await confirmedSeats(ride.id)).toBe(0);
  });

  it('rejects cancelling an ACCEPTED participation on an IN_PROGRESS ride (OD-011)', async () => {
    const creator = await createUser('creator-inprogress');
    const requester = await createUser('requester-inprogress');
    const { ride } = await createRideFixture(creator.id);
    const request = await createPendingRequest(ride.id, requester.id);
    await acceptRequest(request.id, creator.id);

    await prisma.ride.update({
      where: { id: ride.id },
      data: { status: RideStatus.IN_PROGRESS },
    });

    const promise = cancelRideRequest({
      requestId: request.id,
      actorId: requester.id,
    });
    await expect(promise).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(promise).rejects.toMatchObject({ statusCode: 422 });

    const participant = await prisma.rideParticipant.findUniqueOrThrow({
      where: { requestId: request.id },
    });
    expect(participant.status).toBe(ParticipantStatus.CONFIRMED);
    expect(participant.cancelledAt).toBeNull();
  });

  it('rejects cancelling an already-resolved request', async () => {
    const creator = await createUser('creator-already');
    const requester = await createUser('requester-already');
    const { ride } = await createRideFixture(creator.id);
    const request = await createPendingRequest(ride.id, requester.id);

    await cancelRideRequest({ requestId: request.id, actorId: requester.id });

    const promise = cancelRideRequest({
      requestId: request.id,
      actorId: requester.id,
    });
    await expect(promise).rejects.toBeInstanceOf(ConflictError);

    const persisted = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(persisted.status).toBe(RideRequestStatus.CANCELLED);
  });
});
