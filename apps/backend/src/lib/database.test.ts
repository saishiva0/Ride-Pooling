/**
 * Phase 2 database / integration tests.
 *
 * These tests exercise the real PostgreSQL + PostGIS database (not mocks):
 * persistence behavior, relationships, constraints, and spatial storage as
 * defined by `apps/backend/prisma/schema.prisma` and its migration. They do
 * NOT test Ride Engine business logic (no lifecycle transitions, matching,
 * or pricing calculation) — that belongs to a future phase.
 *
 * Requires a reachable dev database with the Phase 2 migration applied
 * (`pnpm --filter @ridepool/backend db:migrate:deploy`).
 *
 * Every fixture created here is tracked and removed in `afterAll` so this
 * suite does not pollute seed data or leave residue between runs.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { Prisma, PricingType, RideStatus } from '@prisma/client';
import { prisma } from './prisma.js';

const RUN_ID = `dbtest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let seq = 0;
function unique(label: string): string {
  seq += 1;
  return `${RUN_ID}_${label}_${seq}`;
}

const cleanup = {
  notificationIds: [] as string[],
  statusHistoryIds: [] as string[],
  participantIds: [] as string[],
  requestIds: [] as string[],
  rideIds: [] as string[],
  locationIds: [] as string[],
  userIds: [] as string[],
};

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { id: { in: cleanup.notificationIds } },
  });
  await prisma.rideStatusHistory.deleteMany({
    where: { id: { in: cleanup.statusHistoryIds } },
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
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.$disconnect();
});

async function createUser(
  label: string,
  overrides: { phone?: string | null; email?: string | null } = {},
) {
  const user = await prisma.user.create({
    data: {
      name: `Test ${label}`,
      phone:
        overrides.phone === undefined ? `+91${unique(label)}` : overrides.phone,
      email: overrides.email,
    },
  });
  cleanup.userIds.push(user.id);
  return user;
}

async function createLocation(
  label: string,
  latitude: number,
  longitude: number,
) {
  const location = await prisma.location.create({
    data: { latitude, longitude, label },
  });
  cleanup.locationIds.push(location.id);
  return location;
}

async function createRide(overrides: {
  creatorId: string;
  pickupLocationId: string;
  destinationLocationId: string;
  status?: RideStatus;
  totalSeats?: number;
  pricingType?: PricingType;
  pricePerKm?: number;
}) {
  const ride = await prisma.ride.create({
    data: {
      creatorId: overrides.creatorId,
      pickupLocationId: overrides.pickupLocationId,
      destinationLocationId: overrides.destinationLocationId,
      departureDateTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      totalSeats: overrides.totalSeats ?? 3,
      pricingType: overrides.pricingType ?? PricingType.STANDARD,
      pricePerKm: overrides.pricePerKm ?? 4,
      status: overrides.status ?? RideStatus.DRAFT,
    },
  });
  cleanup.rideIds.push(ride.id);
  return ride;
}

describe('User persistence', () => {
  it('creates a user with contact info and timestamps', async () => {
    const user = await createUser('user-create');

    expect(user.id).toBeTruthy();
    expect(user.name).toBe('Test user-create');
    expect(user.phone).toBeTruthy();
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
  });
});

describe('Ride persistence with relationships', () => {
  it('creates a ride with valid creator, pickup, and destination relationships', async () => {
    const creator = await createUser('ride-creator');
    const pickup = await createLocation('Pickup A', 12.9716, 77.5946);
    const destination = await createLocation('Destination A', 12.2958, 76.6394);
    const ride = await createRide({
      creatorId: creator.id,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
      status: RideStatus.PUBLISHED,
    });

    const fetched = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
      include: {
        creator: true,
        pickupLocation: true,
        destinationLocation: true,
      },
    });

    expect(fetched.creator.id).toBe(creator.id);
    expect(fetched.pickupLocation.id).toBe(pickup.id);
    expect(fetched.destinationLocation.id).toBe(destination.id);
    expect(fetched.status).toBe(RideStatus.PUBLISHED);
  });
});

describe('RideRequest relationship', () => {
  it('links a ride request to its ride and requesting user', async () => {
    const creator = await createUser('req-creator');
    const requester = await createUser('req-user');
    const pickup = await createLocation('Pickup B', 12.9352, 77.6245);
    const destination = await createLocation('Destination B', 12.8452, 77.6602);
    const ride = await createRide({
      creatorId: creator.id,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
      status: RideStatus.PUBLISHED,
    });

    const request = await prisma.rideRequest.create({
      data: { rideId: ride.id, userId: requester.id, requestedSeats: 2 },
    });
    cleanup.requestIds.push(request.id);

    const fetched = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: { ride: true, user: true },
    });

    expect(fetched.ride.id).toBe(ride.id);
    expect(fetched.user.id).toBe(requester.id);
    expect(fetched.requestedSeats).toBe(2);
    expect(fetched.status).toBe('PENDING');
  });
});

describe('RideParticipant relationship', () => {
  it('links a confirmed participant to the ride, user, and originating request', async () => {
    const creator = await createUser('part-creator');
    const participantUser = await createUser('part-user');
    const pickup = await createLocation('Pickup C', 12.9591, 77.6974);
    const destination = await createLocation('Destination C', 12.9758, 77.6045);
    const ride = await createRide({
      creatorId: creator.id,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
      status: RideStatus.CONFIRMED,
    });
    const request = await prisma.rideRequest.create({
      data: {
        rideId: ride.id,
        userId: participantUser.id,
        status: 'ACCEPTED',
        resolvedAt: new Date(),
      },
    });
    cleanup.requestIds.push(request.id);

    const participant = await prisma.rideParticipant.create({
      data: {
        rideId: ride.id,
        userId: participantUser.id,
        requestId: request.id,
        seatsAllocated: 1,
      },
    });
    cleanup.participantIds.push(participant.id);

    const fetched = await prisma.rideParticipant.findUniqueOrThrow({
      where: { id: participant.id },
      include: { ride: true, user: true, request: true },
    });

    expect(fetched.ride.id).toBe(ride.id);
    expect(fetched.user.id).toBe(participantUser.id);
    expect(fetched.request.id).toBe(request.id);
    expect(fetched.status).toBe('CONFIRMED');
  });
});

describe('RideStatusHistory relationship', () => {
  it('records an append-only, ordered history of ride status transitions', async () => {
    const creator = await createUser('hist-creator');
    const pickup = await createLocation('Pickup D', 12.9121, 77.6446);
    const destination = await createLocation('Destination D', 12.9698, 77.75);
    const ride = await createRide({
      creatorId: creator.id,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
      status: RideStatus.PUBLISHED,
    });

    const first = await prisma.rideStatusHistory.create({
      data: {
        rideId: ride.id,
        fromStatus: null,
        toStatus: RideStatus.DRAFT,
        changedByUserId: creator.id,
      },
    });
    const second = await prisma.rideStatusHistory.create({
      data: {
        rideId: ride.id,
        fromStatus: RideStatus.DRAFT,
        toStatus: RideStatus.PUBLISHED,
        changedByUserId: creator.id,
      },
    });
    cleanup.statusHistoryIds.push(first.id, second.id);

    const history = await prisma.rideStatusHistory.findMany({
      where: { rideId: ride.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(history).toHaveLength(2);
    expect(history[0]?.fromStatus).toBeNull();
    expect(history[0]?.toStatus).toBe(RideStatus.DRAFT);
    expect(history[1]?.fromStatus).toBe(RideStatus.DRAFT);
    expect(history[1]?.toStatus).toBe(RideStatus.PUBLISHED);
  });
});

describe('Notification relationship', () => {
  it('links a notification to its recipient and optional ride context', async () => {
    const recipient = await createUser('notif-user');
    const creator = await createUser('notif-creator');
    const pickup = await createLocation('Pickup E', 12.9758, 77.6045);
    const destination = await createLocation('Destination E', 12.9121, 77.6446);
    const ride = await createRide({
      creatorId: creator.id,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
    });

    const notification = await prisma.notification.create({
      data: {
        userId: recipient.id,
        type: 'RIDE_PUBLISHED',
        title: 'Ride published',
        rideId: ride.id,
      },
    });
    cleanup.notificationIds.push(notification.id);

    const fetched = await prisma.notification.findUniqueOrThrow({
      where: { id: notification.id },
      include: { user: true, ride: true },
    });

    expect(fetched.user.id).toBe(recipient.id);
    expect(fetched.ride?.id).toBe(ride.id);
    expect(fetched.readAt).toBeNull();
  });
});

describe('Unique constraints', () => {
  it('rejects a duplicate phone number', async () => {
    const phone = `+91${unique('dup-phone')}`;
    await createUser('dup-a', { phone });

    await expect(createUser('dup-b', { phone })).rejects.toThrow();
  });

  it('rejects a second active (PENDING/ACCEPTED) request from the same user for the same ride', async () => {
    const creator = await createUser('active-req-creator');
    const requester = await createUser('active-req-user');
    const pickup = await createLocation('Pickup F', 12.9716, 77.6412);
    const destination = await createLocation('Destination F', 12.935, 77.6245);
    const ride = await createRide({
      creatorId: creator.id,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
      status: RideStatus.PUBLISHED,
    });

    const request = await prisma.rideRequest.create({
      data: { rideId: ride.id, userId: requester.id },
    });
    cleanup.requestIds.push(request.id);

    await expect(
      prisma.rideRequest.create({
        data: { rideId: ride.id, userId: requester.id },
      }),
    ).rejects.toThrow();
  });

  it('rejects a second confirmed participation by the same user on the same ride', async () => {
    const creator = await createUser('dup-part-creator');
    const participantUser = await createUser('dup-part-user');
    const pickup = await createLocation('Pickup G', 12.9591, 77.6974);
    const destination = await createLocation('Destination G', 12.8452, 77.6602);
    const ride = await createRide({
      creatorId: creator.id,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
      status: RideStatus.CONFIRMED,
      totalSeats: 4,
    });

    const requestA = await prisma.rideRequest.create({
      data: {
        rideId: ride.id,
        userId: participantUser.id,
        status: 'ACCEPTED',
        resolvedAt: new Date(),
      },
    });
    cleanup.requestIds.push(requestA.id);
    const participantA = await prisma.rideParticipant.create({
      data: {
        rideId: ride.id,
        userId: participantUser.id,
        requestId: requestA.id,
        seatsAllocated: 1,
      },
    });
    cleanup.participantIds.push(participantA.id);

    // A second, independent request+participant row for the SAME user and
    // SAME ride, both CONFIRMED, must be rejected by the partial unique index.
    const requestB = await prisma.rideRequest.create({
      data: {
        rideId: ride.id,
        userId: participantUser.id,
        status: 'CANCELLED',
        resolvedAt: new Date(),
      },
    });
    cleanup.requestIds.push(requestB.id);

    await expect(
      prisma.rideParticipant.create({
        data: {
          rideId: ride.id,
          userId: participantUser.id,
          requestId: requestB.id,
          seatsAllocated: 1,
        },
      }),
    ).rejects.toThrow();
  });
});

describe('Foreign-key integrity', () => {
  it('rejects a ride referencing a non-existent creator', async () => {
    const pickup = await createLocation('Pickup H', 12.9716, 77.6412);
    const destination = await createLocation('Destination H', 12.935, 77.6245);

    await expect(
      prisma.ride.create({
        data: {
          creatorId: 'nonexistent-user-id',
          pickupLocationId: pickup.id,
          destinationLocationId: destination.id,
          departureDateTime: new Date(Date.now() + 86_400_000),
          totalSeats: 2,
          pricingType: PricingType.STANDARD,
          pricePerKm: 4,
        },
      }),
    ).rejects.toThrow();
  });

  it('restricts deleting a user who still has rides', async () => {
    const creator = await createUser('fk-restrict-creator');
    const pickup = await createLocation('Pickup I', 12.9716, 77.6412);
    const destination = await createLocation('Destination I', 12.935, 77.6245);
    await createRide({
      creatorId: creator.id,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
    });

    await expect(
      prisma.user.delete({ where: { id: creator.id } }),
    ).rejects.toThrow();
  });
});

describe('Database-level check constraints', () => {
  it('rejects an out-of-range latitude', async () => {
    await expect(
      prisma.location.create({ data: { latitude: 200, longitude: 0 } }),
    ).rejects.toThrow();
  });

  it('rejects a ride with fewer than 1 total seat', async () => {
    const creator = await createUser('check-seats-creator');
    const pickup = await createLocation('Pickup J', 12.9716, 77.6412);
    const destination = await createLocation('Destination J', 12.935, 77.6245);

    await expect(
      createRide({
        creatorId: creator.id,
        pickupLocationId: pickup.id,
        destinationLocationId: destination.id,
        totalSeats: 0,
      }),
    ).rejects.toThrow();
  });

  it('rejects a ride whose pickup and destination are the same location', async () => {
    const creator = await createUser('check-same-loc-creator');
    const location = await createLocation('Same Location', 12.9716, 77.6412);

    await expect(
      createRide({
        creatorId: creator.id,
        pickupLocationId: location.id,
        destinationLocationId: location.id,
      }),
    ).rejects.toThrow();
  });
});

describe('Spatial (PostGIS) storage and functions', () => {
  it('derives a PostGIS point from latitude/longitude on insert', async () => {
    const location = await createLocation(
      'Spatial Test Point',
      12.9716,
      77.5946,
    );

    const rows = await prisma.$queryRaw<Array<{ text: string; srid: number }>>(
      Prisma.sql`SELECT ST_AsText(point) AS text, ST_SRID(point) AS srid FROM "Location" WHERE id = ${location.id}`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.srid).toBe(4326);
    expect(rows[0]?.text).toContain('POINT');
    expect(rows[0]?.text).toContain('77.5946');
    expect(rows[0]?.text).toContain('12.9716');
  });

  it('has PostGIS available and can compute distance between two points', async () => {
    const versionRows = await prisma.$queryRaw<
      Array<{ postgis_version: string }>
    >(Prisma.sql`SELECT postgis_version()`);
    expect(versionRows[0]?.postgis_version).toBeTruthy();

    const a = await createLocation('Distance A', 12.9716, 77.6412); // Indiranagar
    const b = await createLocation('Distance B', 12.9698, 77.75); // Whitefield

    const distanceRows = await prisma.$queryRaw<Array<{ km: number }>>(
      Prisma.sql`
        SELECT ST_Distance(a.point::geography, b.point::geography) / 1000 AS km
        FROM "Location" a, "Location" b
        WHERE a.id = ${a.id} AND b.id = ${b.id}
      `,
    );

    // Indiranagar → Whitefield is roughly 10-14km straight-line; this is an
    // infrastructure sanity check, not a matching/discovery calculation.
    expect(distanceRows[0]?.km).toBeGreaterThan(5);
    expect(distanceRows[0]?.km).toBeLessThan(20);
  });
});
