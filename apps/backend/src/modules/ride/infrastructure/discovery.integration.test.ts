/**
 * Phase 3.3 real-database / integration tests for Ride Discovery.
 *
 * Exercises the actual PostgreSQL + PostGIS database (no mocks): the
 * `discoverRides` use case end-to-end, including the PostGIS geography
 * spatial filter, seat-eligibility, status eligibility, distance semantics,
 * the mandatory coordinate-order regression test, and read-only behaviour.
 *
 * Requires a reachable dev database with the Phase 2 migration applied.
 * Every fixture created here is tracked and removed in `afterAll`. Fixtures
 * use a modest radius around a Bengaluru base point such that no Phase 2
 * seed ride pickup falls inside the search area (verified: the closest seed
 * pickup that could be eligible, MG Road ~1.1 km away, belongs to an
 * EXPIRED ride and is excluded by status).
 *
 * Latitude offsets are calibrated against PostGIS itself (meters per degree
 * at the base point) so that "1 km north" really measures ~1 km on the
 * WGS84 ellipsoid — the naive 111.2 km/degree constant is ~0.5% short and
 * would make exact-boundary assertions unreliable.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { Prisma, PricingType, RideStatus } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { discoverRides } from '../application/discover-rides.js';
import type { DiscoveredRide } from '../application/discover-rides.js';

const RUN_ID = `disctest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let seq = 0;
function unique(label: string): string {
  seq += 1;
  return `${RUN_ID}_${label}_${seq}`;
}

const cleanup = {
  statusHistoryIds: [] as string[],
  requestIds: [] as string[],
  participantIds: [] as string[],
  rideIds: [] as string[],
  locationIds: [] as string[],
  userIds: [] as string[],
};

afterAll(async () => {
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

const BASE = { lat: 12.9716, lon: 77.5946 };

// Calibrate "meters north of BASE" against PostGIS so offsets are exact.
let cachedMetersPerDegreeLat: number | null = null;
async function metersPerDegreeLat(): Promise<number> {
  if (cachedMetersPerDegreeLat === null) {
    const [{ d }] = await prisma.$queryRaw<Array<{ d: number }>>(Prisma.sql`
      SELECT ST_Distance(
        ST_SetSRID(ST_MakePoint(${BASE.lon}, ${BASE.lat}), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${BASE.lon}, ${BASE.lat} + 1), 4326)::geography
      ) AS d
    `);
    cachedMetersPerDegreeLat = d;
  }
  return cachedMetersPerDegreeLat;
}

async function northOf(meters: number): Promise<{ lat: number; lon: number }> {
  const metersPerDegree = await metersPerDegreeLat();
  return { lat: BASE.lat + meters / metersPerDegree, lon: BASE.lon };
}

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

interface CreateRideFixtureOptions {
  pickup: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  status: RideStatus;
  totalSeats?: number;
}

async function createRideFixture(
  creatorId: string,
  options: CreateRideFixtureOptions,
) {
  const pickup = await createLocation(options.pickup.lat, options.pickup.lon);
  const destination = await createLocation(
    options.destination.lat,
    options.destination.lon,
  );
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
      status: options.status,
    },
  });
  cleanup.rideIds.push(ride.id);
  return { ride, pickup, destination };
}

/** Adds a CONFIRMED participant of `seats` to a ride (via an ACCEPTED request). */
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

function ids(rides: DiscoveredRide[]): string[] {
  return rides.map((r) => r.id);
}

async function domainRowCounts() {
  // Scoped to this file's own fixtures (RUN_ID markers / ride ids) rather
  // than whole-table counts: other test files run in parallel workers
  // against the same database, so global counts would race. Discovery
  // must not create any rows that match this file's markers.
  const [ride, location, history, participant, request, notification, user] =
    await Promise.all([
      prisma.ride.count({ where: { vehicleType: { contains: RUN_ID } } }),
      prisma.location.count({ where: { label: { contains: RUN_ID } } }),
      prisma.rideStatusHistory.count({
        where: { rideId: { in: cleanup.rideIds } },
      }),
      prisma.rideParticipant.count({
        where: { rideId: { in: cleanup.rideIds } },
      }),
      prisma.rideRequest.count({ where: { rideId: { in: cleanup.rideIds } } }),
      prisma.notification.count({ where: { rideId: { in: cleanup.rideIds } } }),
      prisma.user.count({ where: { phone: { contains: RUN_ID } } }),
    ]);
  return { ride, location, history, participant, request, notification, user };
}

describe('discoverRides — real database integration', () => {
  it('returns a PUBLISHED ride within the radius and excludes one outside it', async () => {
    const creator = await createUser('near-far');
    const inside = await createRideFixture(creator.id, {
      pickup: await northOf(500),
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.PUBLISHED,
    });
    const outside = await createRideFixture(creator.id, {
      pickup: await northOf(50_000),
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.PUBLISHED,
    });

    const results = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 2000,
    });

    expect(ids(results)).toContain(inside.ride.id);
    expect(ids(results)).not.toContain(outside.ride.id);
  });

  it('excludes a DRAFT ride within the radius', async () => {
    const creator = await createUser('draft');
    const draft = await createRideFixture(creator.id, {
      pickup: await northOf(200),
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.DRAFT,
    });

    const results = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 2000,
    });

    expect(ids(results)).not.toContain(draft.ride.id);
  });

  it('excludes terminal rides (COMPLETED, CANCELLED, EXPIRED) within the radius', async () => {
    const creator = await createUser('terminal');
    for (const status of [
      RideStatus.COMPLETED,
      RideStatus.CANCELLED,
      RideStatus.EXPIRED,
    ]) {
      const ride = await createRideFixture(creator.id, {
        pickup: await northOf(300),
        destination: { lat: 12.2958, lon: 76.6394 },
        status,
      });

      const results = await discoverRides({
        latitude: BASE.lat,
        longitude: BASE.lon,
        radiusMeters: 2000,
      });

      expect(ids(results)).not.toContain(ride.ride.id);
    }
  });

  it('returns CONFIRMED rides that still have free seats', async () => {
    const creator = await createUser('confirmed');
    const confirmed = await createRideFixture(creator.id, {
      pickup: await northOf(400),
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.CONFIRMED,
      totalSeats: 4,
    });

    const results = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 2000,
    });

    expect(ids(results)).toContain(confirmed.ride.id);
  });

  it('excludes a seat-ineligible ride (no free seats) and reports availableSeats', async () => {
    const creator = await createUser('seats');
    const participantA = await createUser('seats-a');
    const participantB = await createUser('seats-b');
    const full = await createRideFixture(creator.id, {
      pickup: await northOf(450),
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.PUBLISHED,
      totalSeats: 2,
    });
    await addConfirmedParticipant(full.ride.id, participantA.id, 1);
    await addConfirmedParticipant(full.ride.id, participantB.id, 1);

    const partial = await createRideFixture(creator.id, {
      pickup: await northOf(550),
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.PUBLISHED,
      totalSeats: 4,
    });
    await addConfirmedParticipant(partial.ride.id, participantA.id, 1);

    const results = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 2000,
    });

    expect(ids(results)).not.toContain(full.ride.id);

    const partialResult = results.find((r) => r.id === partial.ride.id);
    expect(partialResult).toBeDefined();
    expect(partialResult?.totalSeats).toBe(4);
    expect(partialResult?.availableSeats).toBe(3);
  });

  it('measures the radius in meters and respects the PostGIS boundary', async () => {
    const creator = await createUser('boundary');
    const atBoundary = await createRideFixture(creator.id, {
      pickup: await northOf(1000),
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.PUBLISHED,
    });
    const justInside = await createRideFixture(creator.id, {
      pickup: await northOf(999),
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.PUBLISHED,
    });
    const justOutside = await createRideFixture(creator.id, {
      pickup: await northOf(1001),
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.PUBLISHED,
    });

    const results = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 1000,
    });

    // ST_DWithin(geography, …, meters) is inclusive at distance == radius:
    // a ride placed exactly 1000 m away (measured by PostGIS itself) is
    // returned, 999 m is returned, 1001 m is not.
    expect(ids(results)).toContain(atBoundary.ride.id);
    expect(ids(results)).toContain(justInside.ride.id);
    expect(ids(results)).not.toContain(justOutside.ride.id);
  });

  it('returns multiple nearby rides, nearest first', async () => {
    const creator = await createUser('multiple');
    const near = await createRideFixture(creator.id, {
      pickup: await northOf(100),
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.PUBLISHED,
    });
    const mid = await createRideFixture(creator.id, {
      pickup: await northOf(300),
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.PUBLISHED,
    });
    const far = await createRideFixture(creator.id, {
      pickup: await northOf(700),
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.PUBLISHED,
    });

    const results = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 2000,
    });

    // Other tests in this file create nearby fixtures too (cleaned up only
    // in afterAll), so scope the assertion to this test's own rides and
    // verify they come back nearest-first.
    const mine = results.filter((r) =>
      [near.ride.id, mid.ride.id, far.ride.id].includes(r.id),
    );
    expect(mine.map((r) => r.id)).toEqual([
      near.ride.id,
      mid.ride.id,
      far.ride.id,
    ]);
    const distances = mine.map((r) => r.distanceMeters);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('returns an accurate pickup-to-pickup distanceMeters', async () => {
    const creator = await createUser('distance');
    const atZero = await createRideFixture(creator.id, {
      pickup: { lat: BASE.lat, lon: BASE.lon },
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.PUBLISHED,
    });
    const atOneKm = await createRideFixture(creator.id, {
      pickup: await northOf(1000),
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.PUBLISHED,
    });
    const atFiveKm = await createRideFixture(creator.id, {
      pickup: await northOf(5000),
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.PUBLISHED,
    });

    const results = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 8000,
    });

    const zero = results.find((r) => r.id === atZero.ride.id);
    const oneKm = results.find((r) => r.id === atOneKm.ride.id);
    const fiveKm = results.find((r) => r.id === atFiveKm.ride.id);

    expect(zero?.distanceMeters).toBeLessThan(1);
    expect(oneKm?.distanceMeters).toBeGreaterThan(990);
    expect(oneKm?.distanceMeters).toBeLessThan(1010);
    expect(fiveKm?.distanceMeters).toBeGreaterThan(4990);
    expect(fiveKm?.distanceMeters).toBeLessThan(5010);
    expect(oneKm!.distanceMeters).toBeLessThan(fiveKm!.distanceMeters);
  });

  it('spatial regression: coordinate order is longitude,latitude (ST_MakePoint)', async () => {
    // The classic bug: constructing the participant point as
    // ST_MakePoint(latitude, longitude). The ride at BASE shares the
    // participant's coordinates and MUST be discovered; a ride whose stored
    // coordinates are the transposed pair (lat=77.5946, lon=12.9716) sits
    // ~7,400 km away (77.6°N, 13°E) and MUST NOT be discovered. If the query
    // swapped the order, the BASE ride would be miles away in "query space"
    // and this test would fail.
    const creator = await createUser('coord-order');
    const atBase = await createRideFixture(creator.id, {
      pickup: { lat: BASE.lat, lon: BASE.lon },
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.PUBLISHED,
    });
    const transposed = await createRideFixture(creator.id, {
      pickup: { lat: BASE.lon, lon: BASE.lat },
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.PUBLISHED,
    });

    const results = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 2000,
    });

    expect(ids(results)).toContain(atBase.ride.id);
    expect(ids(results)).not.toContain(transposed.ride.id);
  });

  it('discovery is read-only: it mutates nothing in the database', async () => {
    const creator = await createUser('readonly');
    await createRideFixture(creator.id, {
      pickup: await northOf(150),
      destination: { lat: 12.2958, lon: 76.6394 },
      status: RideStatus.PUBLISHED,
    });

    const before = await domainRowCounts();

    const results = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 2000,
    });
    expect(results.length).toBeGreaterThan(0);

    const after = await domainRowCounts();
    expect(after).toEqual(before);
  });

  it('respects the result limit', async () => {
    const creator = await createUser('limit');
    for (let i = 0; i < 5; i += 1) {
      await createRideFixture(creator.id, {
        pickup: await northOf(100 + i * 100),
        destination: { lat: 12.2958, lon: 76.6394 },
        status: RideStatus.PUBLISHED,
      });
    }

    const results = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 2000,
      limit: 2,
    });

    expect(results).toHaveLength(2);
  });
});
