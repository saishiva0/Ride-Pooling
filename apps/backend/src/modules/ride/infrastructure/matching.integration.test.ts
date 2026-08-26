/**
 * Phase 3.4 real-database integration tests: discovery → matching.
 *
 * Exercises the full read-only pipeline end-to-end against the real
 * PostgreSQL + PostGIS database:
 *
 *   discoverRides(...)  →  DiscoveredRide[]  →  matchRides(...)  →  MatchedRide[]
 *
 * Verifies that Phase 3.3 discovery output feeds matching directly with no
 * raw Prisma types leaking into the application layer, that the ride status
 * carried through discovery is available to the ride-status factor, and that
 * eligibility/ranking decisions behave as documented.
 *
 * Fixtures follow the same conventions as `discovery.integration.test.ts`
 * (RUN_ID prefixes, cleanup in `afterAll`, latitude offsets calibrated
 * against PostGIS).
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { Prisma, PricingType, RideStatus } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { discoverRides } from '../application/discover-rides.js';
import { matchRides } from '../application/match-rides.js';
import type { DiscoveredRide } from '../application/discover-rides.js';
import type { MatchedRide } from '../application/match-rides.js';
import { MATCH_FACTOR_IDS } from '../domain/matching/types.js';

const RUN_ID = `matchtest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let seq = 0;
function unique(label: string): string {
  seq += 1;
  return `${RUN_ID}_${label}_${seq}`;
}

const cleanup = {
  requestIds: [] as string[],
  participantIds: [] as string[],
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

const BASE = { lat: 12.9716, lon: 77.5946 };
const MYSURU = { lat: 12.2958, lon: 76.6394 };

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

async function createRideFixture(
  creatorId: string,
  options: {
    pickup: { lat: number; lon: number };
    destination: { lat: number; lon: number };
    departureDateTime: Date;
    status?: RideStatus;
    totalSeats?: number;
  },
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
      departureDateTime: options.departureDateTime,
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

function ids(rides: DiscoveredRide[]): string[] {
  return rides.map((r) => r.id);
}

const PREFERRED_DEPARTURE = new Date('2026-08-20T10:00:00.000Z');

// Approved V1 matching thresholds (OD-004 — resolved Phase 3.19): 5 km pickup
// radius, ±60 min departure window, 5 km destination tolerance. Server-owned.
const config = {
  pickupRadiusMeters: 5000,
  departureTimeWindowMinutes: 60,
  destinationToleranceMeters: 5000,
};

describe('discovery → matching — real database integration', () => {
  it('matches discovered candidates with structured, type-safe results', async () => {
    const creator = await createUser('pipeline');

    const goodRide = await createRideFixture(creator.id, {
      pickup: await northOf(500),
      destination: MYSURU,
      departureDateTime: PREFERRED_DEPARTURE,
    });
    const farDestination = await createRideFixture(creator.id, {
      pickup: await northOf(600),
      destination: { lat: 12.5, lon: 77.5 }, // ~100 km from the participant's destination
      departureDateTime: PREFERRED_DEPARTURE,
    });
    const timeMismatch = await createRideFixture(creator.id, {
      pickup: await northOf(700),
      destination: MYSURU,
      departureDateTime: new Date(
        PREFERRED_DEPARTURE.getTime() + 5 * 60 * 60_000,
      ),
    });

    const discovered = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 3000,
    });
    expect(ids(discovered)).toEqual(
      expect.arrayContaining([
        goodRide.ride.id,
        farDestination.ride.id,
        timeMismatch.ride.id,
      ]),
    );

    // Discovery output carries status so matching's ride-status factor is
    // evaluable (additive Phase 3.4 change to the Phase 3.3 result).
    const goodDiscovered = discovered.find((r) => r.id === goodRide.ride.id);
    expect(goodDiscovered?.status).toBe(RideStatus.PUBLISHED);

    const matched: MatchedRide[] = matchRides(
      {
        destination: { latitude: MYSURU.lat, longitude: MYSURU.lon },
        preferredDepartureTime: PREFERRED_DEPARTURE,
      },
      discovered,
      config,
    );

    const byId = new Map(matched.map((m) => [m.ride.id, m]));

    // No raw Prisma types leak into the application layer.
    expect(typeof byId.get(goodRide.ride.id)?.ride.pricePerKm).toBe('number');
    expect(typeof byId.get(goodRide.ride.id)?.ride.status).toBe('string');

    // The matching result preserves the discovered candidate unchanged.
    expect(byId.get(goodRide.ride.id)?.ride).toEqual(goodDiscovered);

    // Eligibility follows the ANDed five-factor decision.
    expect(byId.get(goodRide.ride.id)?.eligible).toBe(true);
    expect(byId.get(goodRide.ride.id)?.factors.every((f) => f.eligible)).toBe(
      true,
    );

    const farMatch = byId.get(farDestination.ride.id);
    expect(farMatch?.eligible).toBe(false);
    expect(farMatch?.factors[1]).toMatchObject({
      factor: MATCH_FACTOR_IDS.DESTINATION_COMPATIBILITY,
      eligible: false,
    });

    const timeMatch = byId.get(timeMismatch.ride.id);
    expect(timeMatch?.eligible).toBe(false);
    expect(timeMatch?.factors[2]).toMatchObject({
      factor: MATCH_FACTOR_IDS.TIME_COMPATIBILITY,
      eligible: false,
    });

    // Ranking is by pickup distance (500m < 600m < 700m) regardless of the
    // discovery order.
    const mine = matched.filter((m) =>
      [goodRide.ride.id, farDestination.ride.id, timeMismatch.ride.id].includes(
        m.ride.id,
      ),
    );
    expect(mine.map((m) => m.ride.id)).toEqual([
      goodRide.ride.id,
      farDestination.ride.id,
      timeMismatch.ride.id,
    ]);
  });

  it('rejects a participant destination beyond the configured tolerance for all candidates', async () => {
    const creator = await createUser('strict');
    await createRideFixture(creator.id, {
      pickup: await northOf(400),
      destination: MYSURU,
      departureDateTime: PREFERRED_DEPARTURE,
    });

    const discovered = await discoverRides({
      latitude: BASE.lat,
      longitude: BASE.lon,
      radiusMeters: 3000,
    });

    const matched = matchRides(
      {
        destination: { latitude: 26.9, longitude: 75.8 }, // ~1,600 km away
        preferredDepartureTime: PREFERRED_DEPARTURE,
      },
      discovered,
      config,
    );

    for (const result of matched) {
      expect(result.eligible).toBe(false);
      expect(result.factors[1].eligible).toBe(false);
    }
  });
});
