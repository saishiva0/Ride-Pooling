/**
 * Phase 3.10 HTTP integration tests for the ride API.
 *
 * Runs against the REAL Express application (supertest) and the REAL
 * PostgreSQL database. Authentication uses the explicit TEST/DEVELOPMENT
 * authenticator (`x-test-user-id` header) — production uses the real bearer
 * authenticator (Phase 3.18, OD-005 resolved); this header exists only for
 * integration tests.
 *
 * Covers: create (201 + validation 400 + unauthenticated 401), discovery
 * (200 + invalid query 400), matching (200 with server-controlled OD-004
 * policy + reject caller-supplied policy 400 + determinism + result cap),
 * request creation (201, 422 on non-requestable ride, 409 duplicate),
 * accept/reject (200, 403 non-creator, 404 unknown), cancel (200, 403
 * non-creator, 404 unknown), and the { data } envelope.
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

const RUN_ID = `ridehttp_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let seq = 0;
function unique(label: string): string {
  seq += 1;
  return `${RUN_ID}_${label}_${seq}`;
}

const cleanup = {
  notificationIds: [] as string[],
  requestIds: [] as string[],
  participantIds: [] as string[],
  rideIds: [] as string[],
  locationIds: [] as string[],
  userIds: [] as string[],
};

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { userId: { in: cleanup.userIds } },
  });
  await prisma.notification.deleteMany({
    where: { id: { in: cleanup.notificationIds } },
  });
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

/** A PUBLISHED, discoverable ride fixture near Indiranagar → Whitefield. */
async function createPublishedRide(
  creatorId: string,
  options?: {
    pickupLat?: number;
    pickupLon?: number;
    destinationLat?: number;
    destinationLon?: number;
  },
) {
  const pickup = await createLocation(
    options?.pickupLat ?? 12.9716,
    options?.pickupLon ?? 77.6412,
    'HTTP Pickup',
  );
  const destination = await createLocation(
    options?.destinationLat ?? 12.9698,
    options?.destinationLon ?? 77.75,
    'HTTP Destination',
  );
  const ride = await prisma.ride.create({
    data: {
      creatorId,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
      departureDateTime: new Date(Date.now() + 3600_000),
      totalSeats: 3,
      vehicleType: 'car',
      discoveryRadiusKm: 10,
      pricingType: PricingType.STANDARD,
      pricePerKm: 4,
      estimatedDistanceKm: 12.3,
      estimatedContribution: 49.2,
      status: RideStatus.PUBLISHED,
    },
  });
  cleanup.rideIds.push(ride.id);
  return ride;
}

async function createRequestFixture(rideId: string, userId: string) {
  const rideRequest = await prisma.rideRequest.create({
    data: { rideId, userId, requestedSeats: 1, status: 'PENDING' },
  });
  cleanup.requestIds.push(rideRequest.id);
  return rideRequest;
}

const authHeader = (userId: string) => ({ 'x-test-user-id': userId });

const VALID_CREATE_BODY = {
  pickup: { latitude: 12.9716, longitude: 77.6412, label: 'Indiranagar' },
  destination: { latitude: 12.9698, longitude: 77.75, label: 'Whitefield' },
  departureDateTime: new Date(Date.now() + 7200_000).toISOString(),
  totalSeats: 3,
  vehicleType: 'car',
  discoveryRadiusKm: 8,
  pricingType: 'STANDARD',
  pricePerKm: 4,
};

describe('POST /api/v1/rides — create ride', () => {
  it('creates a ride with the authenticated user as creator (201, { data })', async () => {
    const creator = await createUser('create-creator');

    const res = await request(app)
      .post('/api/v1/rides')
      .set(authHeader(creator.id))
      .send(VALID_CREATE_BODY);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
    const ride = res.body.data;
    expect(ride.id).toBeTruthy();
    expect(ride.status).toBe('DRAFT');
    expect(ride.creator).toEqual({
      id: creator.id,
      name: `Test create-creator`,
    });
    expect(ride.totalSeats).toBe(3);
    expect(ride.pickupLocation.latitude).toBe(12.9716);
    cleanup.rideIds.push(ride.id);
    cleanup.locationIds.push(
      ride.pickupLocation.id,
      ride.destinationLocation.id,
    );
  });

  it('rejects malformed bodies with a structured 400', async () => {
    const creator = await createUser('create-invalid');

    const res = await request(app)
      .post('/api/v1/rides')
      .set(authHeader(creator.id))
      .send({ ...VALID_CREATE_BODY, totalSeats: 'three' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.field).toBe('totalSeats');
  });

  it('rejects a non-ISO departureDateTime with a structured 400', async () => {
    const creator = await createUser('create-bad-date');

    const res = await request(app)
      .post('/api/v1/rides')
      .set(authHeader(creator.id))
      .send({ ...VALID_CREATE_BODY, departureDateTime: 'not-a-date' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.field).toBe('departureDateTime');
  });

  it('rejects an unauthenticated request with 401 (fail closed)', async () => {
    const res = await request(app)
      .post('/api/v1/rides')
      .send(VALID_CREATE_BODY);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('rejects an unknown authenticated user with 401 (identity not verified)', async () => {
    const res = await request(app)
      .post('/api/v1/rides')
      .set(authHeader(`no-such-user-${unique('ghost')}`))
      .send(VALID_CREATE_BODY);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });
});

describe('GET /api/v1/rides/discover', () => {
  it('returns nearby discoverable rides (200, { data })', async () => {
    const creator = await createUser('discover-creator');
    const fixture = await createPublishedRide(creator.id);

    const res = await request(app)
      .get('/api/v1/rides/discover')
      .set(authHeader(creator.id))
      .query({ latitude: 12.9716, longitude: 77.6412, radiusMeters: 5000 });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(
      res.body.data.some((ride: { id: string }) => ride.id === fixture.id),
    ).toBe(true);
    expect(res.body.data[0]).toHaveProperty('distanceMeters');
  });

  it('rejects a malformed numeric query with 400', async () => {
    const user = await createUser('discover-invalid');

    const res = await request(app)
      .get('/api/v1/rides/discover')
      .set(authHeader(user.id))
      .query({ latitude: 'north', longitude: 77.6412, radiusMeters: 5000 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.field).toBe('latitude');
  });

  it('requires authentication (401)', async () => {
    const res = await request(app)
      .get('/api/v1/rides/discover')
      .query({ latitude: 12.9716, longitude: 77.6412, radiusMeters: 5000 });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/rides/match', () => {
  it('returns ranked matches using the server-controlled OD-004 policy (200)', async () => {
    const creator = await createUser('match-creator');
    const requester = await createUser('match-requester');
    const fixture = await createPublishedRide(creator.id);

    const res = await request(app)
      .post('/api/v1/rides/match')
      .set(authHeader(requester.id))
      .send({
        discovery: {
          latitude: 12.9716,
          longitude: 77.6412,
        },
        destination: { latitude: 12.9698, longitude: 77.75 },
        preferredDepartureTime: fixture.departureDateTime.toISOString(),
        requestedSeats: 1,
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const match = res.body.data.find(
      (m: { ride: { id: string } }) => m.ride.id === fixture.id,
    );
    expect(match).toBeDefined();
    expect(match.eligible).toBe(true);
    expect(match.factors.length).toBe(5);
    // No numeric relevance score is exposed (OD-004 — resolved Phase 3.19).
    expect(match).not.toHaveProperty('score');
    for (const factor of match.factors) {
      expect(factor).toHaveProperty('factor');
      expect(factor).toHaveProperty('eligible');
      expect(factor).toHaveProperty('reason');
    }
  });

  it('never returns more than the server-owned 20-result cap', async () => {
    const creator = await createUser('match-cap-creator');
    const requester = await createUser('match-cap-requester');
    await createPublishedRide(creator.id);

    const res = await request(app)
      .post('/api/v1/rides/match')
      .set(authHeader(requester.id))
      .send({
        discovery: {
          latitude: 12.9716,
          longitude: 77.6412,
        },
        destination: { latitude: 12.9698, longitude: 77.75 },
        preferredDepartureTime: new Date(Date.now() + 3600_000).toISOString(),
      });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(20);
  });

  it('is deterministic for identical input (same ordering across calls)', async () => {
    const creator = await createUser('match-deterministic');
    const requester = await createUser('match-deterministic-requester');
    // Use a unique location far from other test fixtures to ensure isolation.
    const uniqueLat = 12.1234;
    const uniqueLon = 77.1234;
    const fixture = await createPublishedRide(creator.id, {
      pickupLat: uniqueLat,
      pickupLon: uniqueLon,
      destinationLat: uniqueLat + 0.01,
      destinationLon: uniqueLon + 0.01,
    });

    const body = {
      discovery: {
        latitude: uniqueLat,
        longitude: uniqueLon,
      },
      destination: { latitude: uniqueLat + 0.01, longitude: uniqueLon + 0.01 },
      preferredDepartureTime: fixture.departureDateTime.toISOString(),
      requestedSeats: 1,
    };

    const first = await request(app)
      .post('/api/v1/rides/match')
      .set(authHeader(requester.id))
      .send(body);
    const second = await request(app)
      .post('/api/v1/rides/match')
      .set(authHeader(requester.id))
      .send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // Determinism: same ordering of ride IDs across calls.
    expect(
      second.body.data.map((m: { ride: { id: string } }) => m.ride.id),
    ).toEqual(first.body.data.map((m: { ride: { id: string } }) => m.ride.id));
    // Our fixture ride should be the top match (exact location match).
    expect(first.body.data[0].ride.id).toBe(fixture.id);
    expect(second.body.data[0].ride.id).toBe(fixture.id);
  });

  it('rejects a caller-supplied matching configuration (400)', async () => {
    const requester = await createUser('match-supplied-config');

    const res = await request(app)
      .post('/api/v1/rides/match')
      .set(authHeader(requester.id))
      .send({
        discovery: {
          latitude: 12.9716,
          longitude: 77.6412,
        },
        destination: { latitude: 12.9698, longitude: 77.75 },
        preferredDepartureTime: new Date(Date.now() + 3600_000).toISOString(),
        matching: {
          pickupRadiusMeters: 5000,
          departureTimeWindowMinutes: 60,
          destinationToleranceMeters: 5000,
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    // zod strict() rejects unknown top-level keys with a validation error;
    // the exact field path may vary, so we only assert the error code.
  });

  it('rejects a caller-supplied discovery radius or limit (400)', async () => {
    const requester = await createUser('match-supplied-limit');

    const res = await request(app)
      .post('/api/v1/rides/match')
      .set(authHeader(requester.id))
      .send({
        discovery: {
          latitude: 12.9716,
          longitude: 77.6412,
          radiusMeters: 5000,
          limit: 20,
        },
        destination: { latitude: 12.9698, longitude: 77.75 },
        preferredDepartureTime: new Date(Date.now() + 3600_000).toISOString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    // zod strict() on the nested discovery object rejects unknown keys;
    // the exact field path may vary, so we only assert the error code.
  });

  it('rejects malformed coordinates with 400', async () => {
    const requester = await createUser('match-bad-coords');

    const res = await request(app)
      .post('/api/v1/rides/match')
      .set(authHeader(requester.id))
      .send({
        discovery: {
          latitude: 12.9716,
          longitude: 'east',
        },
        destination: { latitude: 12.9698, longitude: 77.75 },
        preferredDepartureTime: new Date(Date.now() + 3600_000).toISOString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication (401)', async () => {
    const res = await request(app)
      .post('/api/v1/rides/match')
      .send({
        discovery: {
          latitude: 12.9716,
          longitude: 77.6412,
        },
        destination: { latitude: 12.9698, longitude: 77.75 },
        preferredDepartureTime: new Date(Date.now() + 3600_000).toISOString(),
      });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/rides/:rideId/requests', () => {
  it('creates a PENDING request with the authenticated user as requester (201)', async () => {
    const creator = await createUser('req-creator');
    const requester = await createUser('req-requester');
    const ride = await createPublishedRide(creator.id);

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/requests`)
      .set(authHeader(requester.id))
      .send({ requestedSeats: 1 });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.rideId).toBe(ride.id);
    expect(res.body.data.requester.id).toBe(requester.id);
    cleanup.requestIds.push(res.body.data.id);
  });

  it('rejects a request on a non-requestable (DRAFT) ride with 422', async () => {
    const creator = await createUser('req-draft-creator');
    const requester = await createUser('req-draft-requester');

    const created = await request(app)
      .post('/api/v1/rides')
      .set(authHeader(creator.id))
      .send(VALID_CREATE_BODY);
    const draftRide = created.body.data;
    cleanup.rideIds.push(draftRide.id);
    cleanup.locationIds.push(
      draftRide.pickupLocation.id,
      draftRide.destinationLocation.id,
    );

    const res = await request(app)
      .post(`/api/v1/rides/${draftRide.id}/requests`)
      .set(authHeader(requester.id))
      .send({ requestedSeats: 1 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('rejects a duplicate active request with 409', async () => {
    const creator = await createUser('req-dup-creator');
    const requester = await createUser('req-dup-requester');
    const ride = await createPublishedRide(creator.id);

    const first = await request(app)
      .post(`/api/v1/rides/${ride.id}/requests`)
      .set(authHeader(requester.id))
      .send({ requestedSeats: 1 });
    expect(first.status).toBe(201);
    cleanup.requestIds.push(first.body.data.id);

    const second = await request(app)
      .post(`/api/v1/rides/${ride.id}/requests`)
      .set(authHeader(requester.id))
      .send({ requestedSeats: 1 });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
  });

  it('returns 404 for an unknown ride', async () => {
    const requester = await createUser('req-missing-ride');

    const res = await request(app)
      .post(`/api/v1/rides/${unique('ride')}/requests`)
      .set(authHeader(requester.id))
      .send({ requestedSeats: 1 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/v1/rides/:rideId/requests/:requestId/accept', () => {
  it('accepts a pending request as the creator (200, ride becomes CONFIRMED)', async () => {
    const creator = await createUser('accept-creator');
    const requester = await createUser('accept-requester');
    const ride = await createPublishedRide(creator.id);
    const rideRequest = await createRequestFixture(ride.id, requester.id);

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/requests/${rideRequest.id}/accept`)
      .set(authHeader(creator.id));

    expect(res.status).toBe(200);
    expect(res.body.data.requestStatus).toBe('ACCEPTED');
    expect(res.body.data.participantId).toBeTruthy();
    expect(res.body.data.rideStatus).toBe('CONFIRMED');
    expect(res.body.data.rideStatusChanged).toBe(true);
    cleanup.participantIds.push(res.body.data.participantId);
  });

  it('rejects a non-creator actor with 403', async () => {
    const creator = await createUser('accept-creator');
    const requester = await createUser('accept-requester');
    const stranger = await createUser('accept-stranger');
    const ride = await createPublishedRide(creator.id);
    const rideRequest = await createRequestFixture(ride.id, requester.id);

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/requests/${rideRequest.id}/accept`)
      .set(authHeader(stranger.id));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
  });

  it('returns 404 for an unknown request', async () => {
    const creator = await createUser('accept-missing');
    const ride = await createPublishedRide(creator.id);

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/requests/${unique('request')}/accept`)
      .set(authHeader(creator.id));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/v1/rides/:rideId/requests/:requestId/reject', () => {
  it('rejects a pending request as the creator (200)', async () => {
    const creator = await createUser('reject-creator');
    const requester = await createUser('reject-requester');
    const ride = await createPublishedRide(creator.id);
    const rideRequest = await createRequestFixture(ride.id, requester.id);

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/requests/${rideRequest.id}/reject`)
      .set(authHeader(creator.id));

    expect(res.status).toBe(200);
    expect(res.body.data.requestStatus).toBe('REJECTED');
    expect(res.body.data.rideId).toBe(ride.id);
  });

  it('rejects a non-creator actor with 403', async () => {
    const creator = await createUser('reject-creator');
    const requester = await createUser('reject-requester');
    const stranger = await createUser('reject-stranger');
    const ride = await createPublishedRide(creator.id);
    const rideRequest = await createRequestFixture(ride.id, requester.id);

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/requests/${rideRequest.id}/reject`)
      .set(authHeader(stranger.id));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
  });
});

describe('POST /api/v1/rides/:rideId/cancel', () => {
  it('cancels a ride as its creator (200)', async () => {
    const creator = await createUser('cancel-creator');
    const ride = await createPublishedRide(creator.id);

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/cancel`)
      .set(authHeader(creator.id));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(res.body.data.rideId).toBe(ride.id);
  });

  it('rejects a non-creator actor with 403', async () => {
    const creator = await createUser('cancel-creator');
    const stranger = await createUser('cancel-stranger');
    const ride = await createPublishedRide(creator.id);

    const res = await request(app)
      .post(`/api/v1/rides/${ride.id}/cancel`)
      .set(authHeader(stranger.id));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
  });

  it('returns 404 for an unknown ride', async () => {
    const creator = await createUser('cancel-missing');

    const res = await request(app)
      .post(`/api/v1/rides/${unique('ride')}/cancel`)
      .set(authHeader(creator.id));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
