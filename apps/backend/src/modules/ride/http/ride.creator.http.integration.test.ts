/**
 * Phase 3.17 HTTP integration tests for the creator ride API — publish,
 * start, complete, My Rides list, and creator ride detail.
 *
 * Runs against the REAL Express application (supertest) and the REAL
 * PostgreSQL database. Authentication uses the explicit TEST/DEVELOPMENT
 * authenticator (`x-test-user-id` header) — production uses the real bearer
 * authenticator (Phase 3.18, OD-005 resolved); this header exists only for
 * integration tests.
 *
 * Covers: publish/start/complete happy paths (200), creator authorization
 * (403), illegal state transitions (422), missing rides (404), fail-closed
 * authentication (401) on every new endpoint, the { data } envelope, GET
 * /rides/mine scoping + ordering (departureDateTime ASC, own rides only), and
 * the GET /rides/:rideId creator detail (200 / 403 / 404).
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PricingType, RideStatus } from '@prisma/client';
import { createApp } from '../../../app.js';
import { loadConfig } from '../../../config/index.js';
import { createLogger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { createTestAuthenticator } from '../../auth/http/auth.middleware.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
const app = createApp({
  config,
  logger: createLogger({ level: 'silent', pretty: false }),
  authenticator: createTestAuthenticator(),
});

const RUN_ID = `creatorhttp_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  await prisma.rideStatusHistory.deleteMany({
    where: { rideId: { in: cleanup.rideIds } },
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

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: { name: `Test ${label}`, phone: `+91${unique(label)}` },
  });
  cleanup.userIds.push(user.id);
  return user;
}

async function createLocation(
  latitude: number,
  longitude: number,
  label: string,
) {
  const location = await prisma.location.create({
    data: { latitude, longitude, label },
  });
  cleanup.locationIds.push(location.id);
  return location;
}

/** A ride fixture at an arbitrary status, owned by `creatorId`. */
async function createRideFixture(
  creatorId: string,
  options: {
    status: RideStatus;
    departureDateTime?: Date;
    totalSeats?: number;
  },
) {
  const pickup = await createLocation(12.97, 77.59, 'Creator HTTP Pickup');
  const destination = await createLocation(12.98, 77.75, 'Creator HTTP Dest');
  const ride = await prisma.ride.create({
    data: {
      creatorId,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
      departureDateTime:
        options.departureDateTime ?? new Date(Date.now() + 3600_000),
      totalSeats: options.totalSeats ?? 3,
      vehicleType: 'car',
      discoveryRadiusKm: 10,
      pricingType: PricingType.STANDARD,
      pricePerKm: 4,
      estimatedDistanceKm: 12.3,
      estimatedContribution: 49.2,
      status: options.status,
    },
  });
  cleanup.rideIds.push(ride.id);
  return ride;
}

const authHeader = (userId: string) => ({ 'x-test-user-id': userId });

describe('POST /api/v1/rides/:rideId/publish', () => {
  it('publishes a DRAFT ride as its creator (200, { data })', async () => {
    const creator = await createUser('publish-http');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.DRAFT,
    });

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/publish`)
      .set(authHeader(creator.id));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toMatchObject({
      rideId: ride.id,
      status: 'PUBLISHED',
    });
    expect(res.body.data.publishedAt).toBeTruthy();

    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(persisted.status).toBe(RideStatus.PUBLISHED);
  });

  it('rejects a non-creator actor with 403', async () => {
    const creator = await createUser('publish-http-creator');
    const stranger = await createUser('publish-http-stranger');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.DRAFT,
    });

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/publish`)
      .set(authHeader(stranger.id));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
  });

  it('rejects publishing an already-published ride with 422', async () => {
    const creator = await createUser('publish-http-repeat');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/publish`)
      .set(authHeader(creator.id));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('returns 404 for an unknown ride', async () => {
    const creator = await createUser('publish-http-missing');

    const res = await request(app)
      .post(`/api/v1/rides/${unique('ride')}/publish`)
      .set(authHeader(creator.id));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('fails closed without authentication (401)', async () => {
    const res = await request(app).post(
      `/api/v1/rides/${unique('ride')}/publish`,
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });
});

describe('POST /api/v1/rides/:rideId/start', () => {
  it('starts a PUBLISHED ride as its creator (200)', async () => {
    const creator = await createUser('start-http');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/start`)
      .set(authHeader(creator.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      rideId: ride.id,
      status: 'IN_PROGRESS',
    });
    expect(res.body.data.startedAt).toBeTruthy();
  });

  it('rejects starting a DRAFT ride with 422', async () => {
    const creator = await createUser('start-http-draft');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.DRAFT,
    });

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/start`)
      .set(authHeader(creator.id));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('rejects a non-creator actor with 403', async () => {
    const creator = await createUser('start-http-creator');
    const stranger = await createUser('start-http-stranger');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/start`)
      .set(authHeader(stranger.id));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
  });

  it('fails closed without authentication (401)', async () => {
    const res = await request(app).post(
      `/api/v1/rides/${unique('ride')}/start`,
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/rides/:rideId/complete', () => {
  it('completes an IN_PROGRESS ride as its creator (200)', async () => {
    const creator = await createUser('complete-http');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.IN_PROGRESS,
    });

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/complete`)
      .set(authHeader(creator.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      rideId: ride.id,
      status: 'COMPLETED',
    });
    expect(res.body.data.completedAt).toBeTruthy();
  });

  it('rejects completing a PUBLISHED ride with 422', async () => {
    const creator = await createUser('complete-http-published');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/complete`)
      .set(authHeader(creator.id));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('rejects a non-creator actor with 403', async () => {
    const creator = await createUser('complete-http-creator');
    const stranger = await createUser('complete-http-stranger');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.IN_PROGRESS,
    });

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/complete`)
      .set(authHeader(stranger.id));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
  });

  it('fails closed without authentication (401)', async () => {
    const res = await request(app).post(
      `/api/v1/rides/${unique('ride')}/complete`,
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/rides/mine', () => {
  it('lists only the authenticated creator’s rides, earliest departure first', async () => {
    const creator = await createUser('mine-http');
    const other = await createUser('mine-http-other');

    const late = await createRideFixture(creator.id, {
      status: RideStatus.DRAFT,
      departureDateTime: new Date(Date.now() + 86_400_000),
    });
    const early = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
      departureDateTime: new Date(Date.now() + 3600_000),
    });
    const foreign = await createRideFixture(other.id, {
      status: RideStatus.PUBLISHED,
      departureDateTime: new Date(Date.now() + 7200_000),
    });

    const res = await request(app)
      .get('/api/v1/rides/mine')
      .set(authHeader(creator.id));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const ids = res.body.data.map((r: { id: string }) => r.id);
    expect(ids).toEqual([early.id, late.id]);
    expect(ids).not.toContain(foreign.id);
    const earlyRide = res.body.data.find(
      (r: { id: string }) => r.id === early.id,
    );
    expect(earlyRide.status).toBe('PUBLISHED');
    expect(earlyRide.availableSeats).toBe(3);
    expect(earlyRide.creator.id).toBe(creator.id);
  });

  it('returns an empty list for a creator with no rides', async () => {
    const creator = await createUser('mine-http-empty');

    const res = await request(app)
      .get('/api/v1/rides/mine')
      .set(authHeader(creator.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('fails closed without authentication (401)', async () => {
    const res = await request(app).get('/api/v1/rides/mine');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });
});

describe('GET /api/v1/rides/:rideId (creator detail)', () => {
  it('returns the creator’s own ride with live availableSeats (200)', async () => {
    const creator = await createUser('detail-http');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.CONFIRMED,
      totalSeats: 3,
    });

    const res = await request(app)
      .get(`/api/v1/rides/${ride.id}`)
      .set(authHeader(creator.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: ride.id,
      status: 'CONFIRMED',
      availableSeats: 3,
      totalSeats: 3,
      creator: { id: creator.id },
    });
    expect(res.body.data.pickupLocation).toHaveProperty('latitude');
  });

  it('rejects a non-creator with 403', async () => {
    const creator = await createUser('detail-http-creator');
    const stranger = await createUser('detail-http-stranger');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });

    const res = await request(app)
      .get(`/api/v1/rides/${ride.id}`)
      .set(authHeader(stranger.id));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
  });

  it('returns 404 for an unknown ride', async () => {
    const creator = await createUser('detail-http-missing');

    const res = await request(app)
      .get(`/api/v1/rides/${unique('ride')}`)
      .set(authHeader(creator.id));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('fails closed without authentication (401)', async () => {
    const res = await request(app).get(`/api/v1/rides/${unique('ride')}`);
    expect(res.status).toBe(401);
  });
});
