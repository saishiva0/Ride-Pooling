/**
 * Phase 3.2 database / integration tests for Ride creation.
 *
 * Exercises the real PostgreSQL + PostGIS database (not mocks): the
 * `createRide` use case end-to-end, and `persistNewRide`'s transactional
 * behavior directly, including a genuine mid-transaction rollback forced by
 * a real Postgres CHECK constraint (no production code was weakened to
 * make this possible).
 *
 * Requires a reachable dev database with the Phase 2 migration applied.
 * Every fixture created here is tracked and removed in `afterAll`.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { Prisma, PricingType, RideStatus } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { NotFoundError } from '../../../lib/errors.js';
import { persistNewRide } from './ride.repository.js';
import { createRide } from '../application/create-ride.js';
import type { RideCreationInput } from '../application/create-ride.js';

const RUN_ID = `ridetest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let seq = 0;
function unique(label: string): string {
  seq += 1;
  return `${RUN_ID}_${label}_${seq}`;
}

const cleanup = {
  statusHistoryIds: [] as string[],
  rideIds: [] as string[],
  locationIds: [] as string[],
  userIds: [] as string[],
};

afterAll(async () => {
  await prisma.rideStatusHistory.deleteMany({
    where: { id: { in: cleanup.statusHistoryIds } },
  });
  await prisma.ride.deleteMany({ where: { id: { in: cleanup.rideIds } } });
  await prisma.location.deleteMany({
    where: { id: { in: cleanup.locationIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.$disconnect();
});

async function createTestUser(label: string) {
  const user = await prisma.user.create({
    data: { name: `Test ${label}`, phone: `+91${unique(label)}` },
  });
  cleanup.userIds.push(user.id);
  return user;
}

function buildInput(
  creatorId: string,
  overrides: Partial<RideCreationInput> = {},
): RideCreationInput {
  return {
    creatorId,
    pickup: { latitude: 12.9716, longitude: 77.5946, label: unique('pickup') },
    destination: {
      latitude: 12.2958,
      longitude: 76.6394,
      label: unique('destination'),
    },
    departureDateTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
    totalSeats: 3,
    pricingType: PricingType.STANDARD,
    pricePerKm: 4,
    ...overrides,
  };
}

describe('createRide — real database integration', () => {
  it('creates a Ride, its Locations, and initial RideStatusHistory transactionally', async () => {
    const creator = await createTestUser('creator-happy');
    const input = buildInput(creator.id, { vehicleType: unique('vehicle') });

    const result = await createRide(input);
    cleanup.rideIds.push(result.id);
    cleanup.locationIds.push(
      result.pickupLocation.id,
      result.destinationLocation.id,
    );

    expect(result.status).toBe(RideStatus.DRAFT);
    expect(result.creator.id).toBe(creator.id);

    // 2-3. Verify Ride persisted with correct creator/location relationships.
    const persistedRide = await prisma.ride.findUniqueOrThrow({
      where: { id: result.id },
      include: {
        creator: true,
        pickupLocation: true,
        destinationLocation: true,
      },
    });
    expect(persistedRide.creatorId).toBe(creator.id);
    expect(persistedRide.status).toBe(RideStatus.DRAFT);
    expect(persistedRide.pickupLocation.id).toBe(result.pickupLocation.id);
    expect(persistedRide.destinationLocation.id).toBe(
      result.destinationLocation.id,
    );

    // 4-5. Verify origin/destination Locations persisted with correct coordinates.
    expect(persistedRide.pickupLocation.latitude.toNumber()).toBeCloseTo(
      12.9716,
    );
    expect(persistedRide.destinationLocation.longitude.toNumber()).toBeCloseTo(
      76.6394,
    );

    // 6. Verify PostGIS points were generated correctly for both locations.
    const points = await prisma.$queryRaw<
      Array<{ id: string; text: string; srid: number }>
    >(
      Prisma.sql`
        SELECT id, ST_AsText(point) AS text, ST_SRID(point) AS srid
        FROM "Location"
        WHERE id IN (${Prisma.join([
          persistedRide.pickupLocation.id,
          persistedRide.destinationLocation.id,
        ])})
      `,
    );
    expect(points).toHaveLength(2);
    for (const point of points) {
      expect(point.srid).toBe(4326);
      expect(point.text).toContain('POINT');
    }

    // 7-8. Verify initial RideStatus and RideStatusHistory.
    const history = await prisma.rideStatusHistory.findMany({
      where: { rideId: result.id },
    });
    cleanup.statusHistoryIds.push(...history.map((h) => h.id));
    expect(history).toHaveLength(1);
    expect(history[0]?.fromStatus).toBeNull();
    expect(history[0]?.toStatus).toBe(RideStatus.DRAFT);
    expect(history[0]?.changedByUserId).toBe(creator.id);

    // 9. Creator relationship exposed on the application-layer result.
    expect(result.creator).toEqual({ id: creator.id, name: creator.name });
  });

  it('rejects creation for a non-existent creator and leaves no records behind', async () => {
    const bogusCreatorId = `nonexistent-${unique('creator')}`;
    const pickupLabel = unique('rollback-pickup');
    const destinationLabel = unique('rollback-destination');
    const input = buildInput(bogusCreatorId, {
      pickup: { latitude: 10, longitude: 10, label: pickupLabel },
      destination: { latitude: 20, longitude: 20, label: destinationLabel },
    });

    await expect(createRide(input)).rejects.toBeInstanceOf(NotFoundError);

    const orphanedLocations = await prisma.location.findMany({
      where: { label: { in: [pickupLabel, destinationLabel] } },
    });
    expect(orphanedLocations).toHaveLength(0);

    const orphanedRides = await prisma.ride.findMany({
      where: { creatorId: bogusCreatorId },
    });
    expect(orphanedRides).toHaveLength(0);
  });

  it('rolls back the entire transaction when a later write fails mid-transaction (10)', async () => {
    // Simulates a failure *after* a write has already happened inside the
    // transaction (the pickup Location insert) but *before* the
    // transaction completes (the destination Location insert fails a real
    // Phase 2 CHECK constraint). Production code is not weakened to make
    // this possible — this is a genuine Postgres constraint violation, the
    // same one exercised in `src/lib/database.test.ts`.
    const creator = await createTestUser('creator-rollback');
    const pickupLabel = unique('midtx-pickup');
    const destinationLabel = unique('midtx-destination');
    const vehicleMarker = unique('midtx-vehicle');

    await expect(
      persistNewRide(prisma, {
        creatorId: creator.id,
        pickup: { latitude: 12.9716, longitude: 77.5946, label: pickupLabel },
        destination: {
          latitude: 200,
          longitude: 77.5946,
          label: destinationLabel,
        },
        departureDateTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        totalSeats: 3,
        pricingType: PricingType.STANDARD,
        pricePerKm: 4,
        vehicleType: vehicleMarker,
      }),
    ).rejects.toThrow();

    // Neither Location (including the pickup row that was written before
    // the failing destination write) remains persisted.
    const orphanedLocations = await prisma.location.findMany({
      where: { label: { in: [pickupLabel, destinationLabel] } },
    });
    expect(orphanedLocations).toHaveLength(0);

    // No Ride was left behind (it is created after both Locations).
    const orphanedRides = await prisma.ride.findMany({
      where: { creatorId: creator.id, vehicleType: vehicleMarker },
    });
    expect(orphanedRides).toHaveLength(0);

    // No RideStatusHistory was left behind (it is created last).
    const orphanedHistory = await prisma.rideStatusHistory.findMany({
      where: { changedByUserId: creator.id },
    });
    expect(orphanedHistory).toHaveLength(0);
  });

  it('commits are durable and visible in a subsequent read', async () => {
    const creator = await createTestUser('creator-read-after-write');
    const input = buildInput(creator.id);

    const result = await createRide(input);
    cleanup.rideIds.push(result.id);
    cleanup.locationIds.push(
      result.pickupLocation.id,
      result.destinationLocation.id,
    );
    const history = await prisma.rideStatusHistory.findMany({
      where: { rideId: result.id },
    });
    cleanup.statusHistoryIds.push(...history.map((h) => h.id));

    const freshRead = await prisma.ride.findUnique({
      where: { id: result.id },
    });
    expect(freshRead).not.toBeNull();
  });
});
