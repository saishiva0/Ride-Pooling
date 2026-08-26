/**
 * Phase 3.6 CRITICAL concurrency tests for request acceptance/rejection.
 *
 * These tests are mandatory per the phase specification. They race real
 * accept/reject operations against the real PostgreSQL database and then
 * VERIFY THE FINAL DATABASE STATE (not just promise outcomes):
 *
 *   TEST A — ride totalSeats = 1, two 1-seat requests, concurrent accepts
 *            → exactly one succeeds, confirmed seats = 1, never > 1.
 *   TEST B — ride totalSeats = 2, one 2-seat + one 1-seat request
 *            → exactly one succeeds, confirmed seats never exceed 2.
 *   TEST C — the same request accepted concurrently twice
 *            → exactly one participant, no double allocation.
 *   TEST D — concurrent accept + reject of the same request
 *            → exactly one terminal outcome, participant only if accept wins.
 *
 * The seat-race safety comes from the ride row lock (`SELECT ... FOR UPDATE`)
 * in `lockRideForDecision` plus re-reading the request after acquiring the
 * lock inside the same transaction (see `docs/development/phase-3-6-notes.md`).
 *
 * Requires a reachable dev database with the Phase 2 migration applied.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ParticipantStatus,
  PricingType,
  RideRequestStatus,
  RideStatus,
} from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { BusinessRuleError, ConflictError } from '../../../lib/errors.js';
import { createRideRequest } from '../application/create-ride-request.js';
import { acceptRideRequest } from '../application/accept-ride-request.js';
import { rejectRideRequest } from '../application/reject-ride-request.js';
import type { AcceptedRideRequest } from '../application/accept-ride-request.js';
import type { RejectedRideRequest } from '../application/reject-ride-request.js';

const RUN_ID = `conctest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  totalSeats: number,
): Promise<{ id: string }> {
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
      totalSeats,
      vehicleType: unique('vehicle'),
      pricingType: PricingType.STANDARD,
      pricePerKm: 4,
      status: RideStatus.PUBLISHED,
    },
    select: { id: true },
  });
  cleanup.rideIds.push(ride.id);
  return ride;
}

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

/** Live DB sum of CONFIRMED participant seats (the invariant guard). */
async function confirmedSeats(rideId: string): Promise<number> {
  const result = await prisma.rideParticipant.aggregate({
    where: { rideId, status: ParticipantStatus.CONFIRMED },
    _sum: { seatsAllocated: true },
  });
  return result._sum.seatsAllocated ?? 0;
}

async function requestStatus(requestId: string): Promise<RideRequestStatus> {
  const row = await prisma.rideRequest.findUniqueOrThrow({
    where: { id: requestId },
  });
  return row.status;
}

async function participantFor(requestId: string): Promise<boolean> {
  return (await prisma.rideParticipant.count({ where: { requestId } })) === 1;
}

type AcceptResult = AcceptedRideRequest | RejectedRideRequest;

function isAccepted(r: AcceptResult): r is AcceptedRideRequest {
  return r.requestStatus === RideRequestStatus.ACCEPTED;
}

describe('TEST A — ride totalSeats = 1, two 1-seat requests accepted concurrently', () => {
  it('exactly one acceptance succeeds and confirmed seats never exceed 1', async () => {
    const creator = await createUser('creator-A');
    const a = await createUser('requester-A1');
    const b = await createUser('requester-A2');
    const ride = await createRideFixture(creator.id, 1);
    const requestA = await createPendingRequest(ride.id, a.id, 1);
    const requestB = await createPendingRequest(ride.id, b.id, 1);

    const attempts = await Promise.allSettled([
      acceptRideRequest({ requestId: requestA.id, actorId: creator.id }),
      acceptRideRequest({ requestId: requestB.id, actorId: creator.id }),
    ]);

    const fulfilled = attempts.filter((x) => x.status === 'fulfilled') as Array<
      PromiseFulfilledResult<AcceptResult>
    >;
    const rejected = attempts.filter(
      (x) => x.status === 'rejected',
    ) as Array<PromiseRejectedResult>;

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(BusinessRuleError);

    const winner = fulfilled[0]!.value;
    expect(isAccepted(winner)).toBe(true);
    if (isAccepted(winner)) {
      cleanup.participantIds.push(winner.participantId);
      expect(winner.allocatedSeats).toBe(1);
    }

    // Final database state — the real verification.
    expect(await confirmedSeats(ride.id)).toBe(1);
    expect(await confirmedSeats(ride.id)).toBeLessThanOrEqual(1);
    const statuses = await Promise.all([
      requestStatus(requestA.id),
      requestStatus(requestB.id),
    ]);
    expect(
      statuses.filter((s) => s === RideRequestStatus.ACCEPTED),
    ).toHaveLength(1);
    expect(
      statuses.filter((s) => s === RideRequestStatus.PENDING),
    ).toHaveLength(1);
    const rideAfter = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(rideAfter.status).toBe(RideStatus.CONFIRMED);
  });
});

describe('TEST B — ride totalSeats = 2, one 2-seat + one 1-seat request accepted concurrently', () => {
  it('exactly one acceptance succeeds and confirmed seats never exceed 2', async () => {
    const creator = await createUser('creator-B');
    const a = await createUser('requester-B1');
    const b = await createUser('requester-B2');
    const ride = await createRideFixture(creator.id, 2);
    const requestA = await createPendingRequest(ride.id, a.id, 2);
    const requestB = await createPendingRequest(ride.id, b.id, 1);

    const attempts = await Promise.allSettled([
      acceptRideRequest({ requestId: requestA.id, actorId: creator.id }),
      acceptRideRequest({ requestId: requestB.id, actorId: creator.id }),
    ]);

    const fulfilled = attempts.filter((x) => x.status === 'fulfilled') as Array<
      PromiseFulfilledResult<AcceptResult>
    >;
    const rejected = attempts.filter(
      (x) => x.status === 'rejected',
    ) as Array<PromiseRejectedResult>;

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(BusinessRuleError);

    const winner = fulfilled[0]!.value;
    expect(isAccepted(winner)).toBe(true);
    let winnerSeats = 0;
    if (isAccepted(winner)) {
      cleanup.participantIds.push(winner.participantId);
      winnerSeats = winner.allocatedSeats;
    }

    // The winner allocated exactly its requested seats (2 if the 2-seat
    // request won, 1 if the 1-seat request won); whichever wins, the loser
    // failed with insufficient seats and capacity was never exceeded.
    const total = await confirmedSeats(ride.id);
    expect(total).toBe(winnerSeats);
    expect(total).toBeGreaterThanOrEqual(1);
    expect(total).toBeLessThanOrEqual(2);

    const statuses = await Promise.all([
      requestStatus(requestA.id),
      requestStatus(requestB.id),
    ]);
    expect(
      statuses.filter((s) => s === RideRequestStatus.ACCEPTED),
    ).toHaveLength(1);
  });
});

describe('TEST C — the same request accepted concurrently twice', () => {
  it('creates exactly one participant and one successful acceptance', async () => {
    const creator = await createUser('creator-C');
    const requester = await createUser('requester-C');
    const ride = await createRideFixture(creator.id, 3);
    const request = await createPendingRequest(ride.id, requester.id, 1);

    const attempts = await Promise.allSettled([
      acceptRideRequest({ requestId: request.id, actorId: creator.id }),
      acceptRideRequest({ requestId: request.id, actorId: creator.id }),
    ]);

    const fulfilled = attempts.filter((x) => x.status === 'fulfilled') as Array<
      PromiseFulfilledResult<AcceptResult>
    >;
    const rejected = attempts.filter(
      (x) => x.status === 'rejected',
    ) as Array<PromiseRejectedResult>;

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConflictError);

    const winner = fulfilled[0]!.value;
    expect(isAccepted(winner)).toBe(true);
    if (isAccepted(winner)) {
      cleanup.participantIds.push(winner.participantId);
    }

    // Final database state.
    expect(
      await prisma.rideParticipant.count({ where: { requestId: request.id } }),
    ).toBe(1);
    expect(await confirmedSeats(ride.id)).toBe(1);
    expect(await requestStatus(request.id)).toBe(RideRequestStatus.ACCEPTED);
  });
});

describe('TEST D — concurrent accept + reject of the same request', () => {
  it('exactly one terminal outcome wins and the database stays consistent', async () => {
    const creator = await createUser('creator-D');
    const requester = await createUser('requester-D');
    const ride = await createRideFixture(creator.id, 2);
    const request = await createPendingRequest(ride.id, requester.id, 1);

    const attempts = await Promise.allSettled([
      acceptRideRequest({ requestId: request.id, actorId: creator.id }),
      rejectRideRequest({ requestId: request.id, actorId: creator.id }),
    ]);

    const fulfilled = attempts.filter((x) => x.status === 'fulfilled') as Array<
      PromiseFulfilledResult<AcceptResult>
    >;
    const rejected = attempts.filter(
      (x) => x.status === 'rejected',
    ) as Array<PromiseRejectedResult>;

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConflictError);

    const winner = fulfilled[0]!.value;
    const finalStatus = await requestStatus(request.id);
    const hasParticipant = await participantFor(request.id);

    if (isAccepted(winner)) {
      cleanup.participantIds.push(winner.participantId);
      expect(finalStatus).toBe(RideRequestStatus.ACCEPTED);
      expect(hasParticipant).toBe(true);
      expect(await confirmedSeats(ride.id)).toBe(1);
      const rideAfter = await prisma.ride.findUniqueOrThrow({
        where: { id: ride.id },
      });
      expect(rideAfter.status).toBe(RideStatus.CONFIRMED);
    } else {
      expect(finalStatus).toBe(RideRequestStatus.REJECTED);
      expect(hasParticipant).toBe(false);
      expect(await confirmedSeats(ride.id)).toBe(0);
    }

    // Exactly one terminal request state; the losing operation mutated nothing.
    expect([RideRequestStatus.ACCEPTED, RideRequestStatus.REJECTED]).toContain(
      finalStatus,
    );
    const participantRequestIds = await prisma.rideParticipant.findMany({
      where: { rideId: ride.id },
      select: { requestId: true },
    });
    expect(participantRequestIds.length).toBe(hasParticipant ? 1 : 0);
  });
});

describe('race condition verification (after every concurrency test)', () => {
  it('keeps the accepted-request ↔ participant relationship 1:1 and requestId unique', async () => {
    const creator = await createUser('creator-invariant');
    const a = await createUser('requester-invariant-1');
    const b = await createUser('requester-invariant-2');
    const ride = await createRideFixture(creator.id, 2);
    const requestA = await createPendingRequest(ride.id, a.id, 1);
    const requestB = await createPendingRequest(ride.id, b.id, 1);

    const attempts = await Promise.allSettled([
      acceptRideRequest({ requestId: requestA.id, actorId: creator.id }),
      acceptRideRequest({ requestId: requestB.id, actorId: creator.id }),
    ]);
    for (const attempt of attempts) {
      if (attempt.status === 'fulfilled' && isAccepted(attempt.value)) {
        cleanup.participantIds.push(attempt.value.participantId);
      }
    }

    // Invariant: SUM(confirmed participant seats) <= ride.totalSeats.
    expect(await confirmedSeats(ride.id)).toBeLessThanOrEqual(2);

    // Invariant: every accepted request has exactly one participant, and no
    // request (accepted or pending) has more than one participant row.
    const accepted = await prisma.rideRequest.findMany({
      where: { rideId: ride.id, status: RideRequestStatus.ACCEPTED },
      select: { id: true },
    });
    for (const req of accepted) {
      expect(await participantFor(req.id)).toBe(true);
    }
    const dupes = await prisma.rideParticipant.groupBy({
      by: ['requestId'],
      where: { rideId: ride.id },
      _count: { _all: true },
    });
    for (const group of dupes) {
      expect(group._count._all).toBe(1);
    }
  });
});
