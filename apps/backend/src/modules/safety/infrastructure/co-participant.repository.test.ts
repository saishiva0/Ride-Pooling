/**
 * Real-database integration tests for the Phase 3.24 ride-co-participant
 * eligibility check — the implied FK/check that gates report/block
 * creation (§9/§11/§13, Product owner decision, 2026-08-21).
 *
 * Requires a reachable dev database with the Phase 2/3.24 migrations
 * applied. Fixtures follow the existing conventions: RUN_ID prefixes,
 * cleanup in `afterAll`.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { PricingType, RideStatus } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { areRideCoParticipants } from './co-participant.repository.js';

const RUN_ID = `coptest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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

// A coordinate deliberately far from the shared Bengaluru `BASE` point used
// by `discovery.integration.test.ts` / `matching.integration.test.ts` (and
// this phase's own `block-effects.integration.test.ts`) — this file creates
// PUBLISHED rides too, and must never pollute those discovery-radius tests
// that run concurrently against the same real database.
async function createLocation() {
  const location = await prisma.location.create({
    data: { latitude: 2, longitude: 2, label: unique('loc') },
  });
  cleanup.locationIds.push(location.id);
  return location;
}

async function createRide(creatorId: string) {
  const pickup = await createLocation();
  const destination = await createLocation();
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

async function addParticipant(
  rideId: string,
  userId: string,
  status: 'CONFIRMED' | 'CANCELLED' = 'CONFIRMED',
) {
  const request = await prisma.rideRequest.create({
    data: {
      rideId,
      userId,
      requestedSeats: 1,
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
      seatsAllocated: 1,
      status,
      cancelledAt: status === 'CANCELLED' ? new Date() : null,
    },
  });
  cleanup.participantIds.push(participant.id);
  return participant;
}

async function addPendingRequestOnly(rideId: string, userId: string) {
  const request = await prisma.rideRequest.create({
    data: { rideId, userId, requestedSeats: 1, status: 'PENDING' },
  });
  cleanup.requestIds.push(request.id);
  return request;
}

describe('areRideCoParticipants — real database integration', () => {
  it('is true for a ride creator and a CONFIRMED participant', async () => {
    const creator = await createUser('creator-confirmed');
    const participant = await createUser('participant-confirmed');
    const ride = await createRide(creator.id);
    await addParticipant(ride.id, participant.id, 'CONFIRMED');

    expect(
      await areRideCoParticipants(prisma, creator.id, participant.id),
    ).toBe(true);
    // Symmetric — order does not matter.
    expect(
      await areRideCoParticipants(prisma, participant.id, creator.id),
    ).toBe(true);
  });

  it('is true even for a CANCELLED participant row (decision text has no status qualifier)', async () => {
    const creator = await createUser('creator-cancelled');
    const participant = await createUser('participant-cancelled');
    const ride = await createRide(creator.id);
    await addParticipant(ride.id, participant.id, 'CANCELLED');

    expect(
      await areRideCoParticipants(prisma, creator.id, participant.id),
    ).toBe(true);
  });

  it('is true for two CONFIRMED participants on the same ride (neither is the creator)', async () => {
    const creator = await createUser('creator-two-participants');
    const participantA = await createUser('participant-a');
    const participantB = await createUser('participant-b');
    const ride = await createRide(creator.id);
    await addParticipant(ride.id, participantA.id, 'CONFIRMED');
    await addParticipant(ride.id, participantB.id, 'CONFIRMED');

    expect(
      await areRideCoParticipants(prisma, participantA.id, participantB.id),
    ).toBe(true);
  });

  it('is false for two users who never shared a ride', async () => {
    const userA = await createUser('unrelated-a');
    const userB = await createUser('unrelated-b');

    expect(await areRideCoParticipants(prisma, userA.id, userB.id)).toBe(false);
  });

  it('is false for a creator and a user with only a pending RideRequest (no RideParticipant row)', async () => {
    const creator = await createUser('creator-pending-only');
    const requester = await createUser('requester-pending-only');
    const ride = await createRide(creator.id);
    await addPendingRequestOnly(ride.id, requester.id);

    expect(await areRideCoParticipants(prisma, creator.id, requester.id)).toBe(
      false,
    );
  });
});
