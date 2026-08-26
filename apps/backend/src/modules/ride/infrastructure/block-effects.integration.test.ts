/**
 * Phase 3.24 (Reporting & Blocking) real-database integration tests for the
 * `ride` module's block-awareness (§13 — DECIDED, Product owner decision,
 * 2026-08-21):
 *
 *   1. An active block excludes the blocked pair from each other's
 *      discovery results, going forward, in EITHER direction.
 *   2. An active block blocks a NEW ride request between the pair.
 *   3. An active block does NOT retroactively cancel an existing CONFIRMED
 *      participation between the two users — that is untouched.
 *
 * Uses the real `Block` table (no mocks) against the real `discoverRides`
 * and `createRideRequest` use cases, mirroring the existing
 * `discovery.integration.test.ts` / `request.integration.test.ts`
 * conventions.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { ParticipantStatus, PricingType, RideStatus } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { BusinessRuleError } from '../../../lib/errors.js';
import { discoverRides } from '../application/discover-rides.js';
import { createRideRequest } from '../application/create-ride-request.js';

const RUN_ID = `blockfx_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  await prisma.block.deleteMany({
    where: {
      OR: [
        { blockerId: { in: cleanup.userIds } },
        { blockedId: { in: cleanup.userIds } },
      ],
    },
  });
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
  await prisma.notification.deleteMany({
    where: { userId: { in: cleanup.userIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.$disconnect();
});

// Deliberately NOT the shared Bengaluru `BASE` point used by
// `discovery.integration.test.ts` / `matching.integration.test.ts` — this
// file creates its own PUBLISHED rides for discovery-radius assertions and
// must never pollute (or be polluted by) those tests when both run
// concurrently against the same real database.
const BASE = { lat: 1, lon: 1 };

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
  const pickup = await createLocation(BASE.lat, BASE.lon);
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
  return ride;
}

async function addConfirmedParticipant(
  rideId: string,
  userId: string,
  seats = 1,
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
  return participant;
}

async function createActiveBlock(blockerId: string, blockedId: string) {
  const block = await prisma.block.create({ data: { blockerId, blockedId } });
  return block;
}

describe('discoverRides — excludes an actively-blocked pair (§13, DECIDED)', () => {
  it("excludes the blocker's rides from the blocked user's discovery results", async () => {
    const creator = await createUser('discover-blocked-creator');
    const viewer = await createUser('discover-blocked-viewer');
    const ride = await createRideFixture(creator.id);
    await createActiveBlock(viewer.id, creator.id); // viewer blocked creator

    const withoutViewer = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 2000,
    });
    expect(withoutViewer.map((r) => r.id)).toContain(ride.id);

    const withViewer = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 2000,
      viewerId: viewer.id,
    });
    expect(withViewer.map((r) => r.id)).not.toContain(ride.id);
  });

  it('excludes the pair symmetrically — the other direction also excludes', async () => {
    const creator = await createUser('discover-blocked-by-creator');
    const viewer = await createUser('discover-blocked-by-viewer');
    const ride = await createRideFixture(creator.id);
    await createActiveBlock(creator.id, viewer.id); // creator blocked viewer

    const results = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 2000,
      viewerId: viewer.id,
    });
    expect(results.map((r) => r.id)).not.toContain(ride.id);
  });

  it('does not exclude rides once the block has been unblocked', async () => {
    const creator = await createUser('discover-unblocked-creator');
    const viewer = await createUser('discover-unblocked-viewer');
    const ride = await createRideFixture(creator.id);
    const block = await createActiveBlock(viewer.id, creator.id);
    await prisma.block.update({
      where: { id: block.id },
      data: { unblockedAt: new Date() },
    });

    const results = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 2000,
      viewerId: viewer.id,
    });
    expect(results.map((r) => r.id)).toContain(ride.id);
  });

  it('does not affect discovery for an unrelated third party', async () => {
    const creator = await createUser('discover-third-party-creator');
    const viewer = await createUser('discover-third-party-viewer');
    const thirdParty = await createUser('discover-third-party-viewer2');
    const ride = await createRideFixture(creator.id);
    await createActiveBlock(viewer.id, creator.id);

    const results = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 2000,
      viewerId: thirdParty.id,
    });
    expect(results.map((r) => r.id)).toContain(ride.id);
  });
});

describe('createRideRequest — blocks a NEW request between an actively-blocked pair (§13, DECIDED)', () => {
  it('rejects a request from a blocked requester to the ride creator', async () => {
    const creator = await createUser('request-blocked-creator');
    const requester = await createUser('request-blocked-requester');
    const ride = await createRideFixture(creator.id);
    await createActiveBlock(creator.id, requester.id);

    await expect(
      createRideRequest({ rideId: ride.id, requesterId: requester.id }),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    const count = await prisma.rideRequest.count({
      where: { rideId: ride.id, userId: requester.id },
    });
    expect(count).toBe(0);
  });

  it('rejects the request symmetrically when the requester is the blocker', async () => {
    const creator = await createUser('request-blocker-creator');
    const requester = await createUser('request-blocker-requester');
    const ride = await createRideFixture(creator.id);
    await createActiveBlock(requester.id, creator.id);

    await expect(
      createRideRequest({ rideId: ride.id, requesterId: requester.id }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('allows the request once the block has been unblocked', async () => {
    const creator = await createUser('request-unblocked-creator');
    const requester = await createUser('request-unblocked-requester');
    const ride = await createRideFixture(creator.id);
    const block = await createActiveBlock(creator.id, requester.id);
    await prisma.block.update({
      where: { id: block.id },
      data: { unblockedAt: new Date() },
    });

    const result = await createRideRequest({
      rideId: ride.id,
      requesterId: requester.id,
    });
    cleanup.requestIds.push(result.id);
    expect(result.status).toBe('PENDING');
  });
});

describe('A block does NOT cancel an existing CONFIRMED participation (§13, DECIDED)', () => {
  it('leaves an existing CONFIRMED RideParticipant untouched after a block is created', async () => {
    const creator = await createUser('confirmed-untouched-creator');
    const participant = await createUser('confirmed-untouched-participant');
    const ride = await createRideFixture(creator.id, { totalSeats: 4 });
    const confirmed = await addConfirmedParticipant(ride.id, participant.id, 2);

    // The two are already CONFIRMED co-participants; now one blocks the other.
    await createActiveBlock(creator.id, participant.id);

    const stored = await prisma.rideParticipant.findUnique({
      where: { id: confirmed.id },
    });
    expect(stored?.status).toBe(ParticipantStatus.CONFIRMED);
    expect(stored?.cancelledAt).toBeNull();
    expect(stored?.seatsAllocated).toBe(2);
  });
});
