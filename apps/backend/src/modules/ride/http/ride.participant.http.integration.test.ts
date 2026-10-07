/**
 * V1 rider read path HTTP integration tests — the participant's own requests
 * (GET /rides/requests/mine), their joined rides (GET /rides/joined), and the
 * participant-authorized ride detail (GET /rides/:rideId).
 *
 * Runs against the REAL Express application (supertest) and the REAL
 * PostgreSQL database. Authentication uses the explicit TEST/DEVELOPMENT
 * authenticator (`x-test-user-id` header) — production uses the real bearer
 * authenticator (Phase 3.18, OD-005 resolved); this header exists only for
 * integration tests.
 *
 * Covers: authenticated participant retrieves own requests (persisted status),
 * another user cannot retrieve them, confirmed participant retrieves a joined
 * ride, unrelated user cannot retrieve participant-only ride data, creator
 * behavior is unchanged, participant history is persisted/retrievable,
 * unauthorized access returns the canonical error, and fail-closed auth.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  ParticipantStatus,
  PricingType,
  RideRequestStatus,
  RideStatus,
} from '@prisma/client';
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

const RUN_ID = `participanthttp_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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

async function createRideFixture(
  creatorId: string,
  options: {
    status?: RideStatus;
    departureDateTime?: Date;
    totalSeats?: number;
  } = {},
) {
  const pickup = await prisma.location.create({
    data: {
      latitude: 12.97,
      longitude: 77.59,
      label: 'Participant HTTP Pickup',
    },
  });
  const destination = await prisma.location.create({
    data: { latitude: 12.98, longitude: 77.75, label: 'Participant HTTP Dest' },
  });
  cleanup.locationIds.push(pickup.id, destination.id);
  const ride = await prisma.ride.create({
    data: {
      creatorId,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
      departureDateTime:
        options.departureDateTime ?? new Date(Date.now() + 3600_000),
      totalSeats: options.totalSeats ?? 3,
      pricingType: PricingType.STANDARD,
      pricePerKm: 4,
      status: options.status ?? RideStatus.PUBLISHED,
    },
  });
  cleanup.rideIds.push(ride.id);
  return ride;
}

/** Creates a request for `userId` and optionally a CONFIRMED participant. */
async function createRequestFixture(
  rideId: string,
  userId: string,
  options: {
    status?: RideRequestStatus;
    confirmed?: boolean;
    seats?: number;
  } = {},
) {
  const seats = options.seats ?? 1;
  const request = await prisma.rideRequest.create({
    data: {
      rideId,
      userId,
      requestedSeats: seats,
      status: options.status ?? RideRequestStatus.PENDING,
      resolvedAt:
        options.status && options.status !== RideRequestStatus.PENDING
          ? new Date()
          : null,
    },
  });
  cleanup.requestIds.push(request.id);
  if (options.confirmed) {
    const participant = await prisma.rideParticipant.create({
      data: {
        rideId,
        userId,
        requestId: request.id,
        seatsAllocated: seats,
        status: ParticipantStatus.CONFIRMED,
      },
    });
    cleanup.participantIds.push(participant.id);
  }
  return request;
}

const authHeader = (userId: string) => ({ 'x-test-user-id': userId });

describe('GET /api/v1/rides/requests/mine', () => {
  it('returns only the authenticated participant’s own persisted requests', async () => {
    const creator = await createUser('req-mine-creator');
    const participant = await createUser('req-mine-participant');
    const other = await createUser('req-mine-other');

    const ride = await createRideFixture(creator.id);
    const mine = await createRequestFixture(ride.id, participant.id, {
      status: RideRequestStatus.PENDING,
      seats: 2,
    });
    await createRequestFixture(ride.id, other.id, {
      status: RideRequestStatus.REJECTED,
      seats: 1,
    });

    const res = await request(app)
      .get('/api/v1/rides/requests/mine')
      .set(authHeader(participant.id));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const ids = res.body.data.map(
      (r: { request: { id: string } }) => r.request.id,
    );
    expect(ids).toEqual([mine.id]);
    expect(res.body.data[0].request).toMatchObject({
      id: mine.id,
      requestedSeats: 2,
      status: 'PENDING',
    });
    expect(res.body.data[0].ride).toMatchObject({
      id: ride.id,
      status: 'PUBLISHED',
      creator: { id: creator.id },
    });
    expect(res.body.data[0].ride).toHaveProperty('availableSeats');
  });

  it('returns the persisted resolved status of an accepted request', async () => {
    const creator = await createUser('req-mine-accepted-creator');
    const participant = await createUser('req-mine-accepted');

    const ride = await createRideFixture(creator.id, {
      status: RideStatus.CONFIRMED,
    });
    const accepted = await createRequestFixture(ride.id, participant.id, {
      status: RideRequestStatus.ACCEPTED,
      confirmed: true,
      seats: 1,
    });

    const res = await request(app)
      .get('/api/v1/rides/requests/mine')
      .set(authHeader(participant.id));

    expect(res.status).toBe(200);
    expect(res.body.data[0].request).toMatchObject({
      id: accepted.id,
      status: 'ACCEPTED',
    });
    expect(res.body.data[0].request.resolvedAt).toBeTruthy();
  });

  it('returns an empty list for a participant with no requests', async () => {
    const participant = await createUser('req-mine-empty');
    const res = await request(app)
      .get('/api/v1/rides/requests/mine')
      .set(authHeader(participant.id));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('fails closed without authentication (401)', async () => {
    const res = await request(app).get('/api/v1/rides/requests/mine');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });
});

describe('GET /api/v1/rides/joined', () => {
  it('returns the rides the participant is confirmed on', async () => {
    const creator = await createUser('joined-creator');
    const participant = await createUser('joined-participant');
    const other = await createUser('joined-other');

    const joined = await createRideFixture(creator.id, {
      status: RideStatus.CONFIRMED,
      departureDateTime: new Date(Date.now() + 3600_000),
    });
    await createRequestFixture(joined.id, participant.id, {
      status: RideRequestStatus.ACCEPTED,
      confirmed: true,
    });

    // A request that was never confirmed must not appear.
    const notConfirmed = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
      departureDateTime: new Date(Date.now() + 7200_000),
    });
    await createRequestFixture(notConfirmed.id, participant.id, {
      status: RideRequestStatus.PENDING,
    });

    const res = await request(app)
      .get('/api/v1/rides/joined')
      .set(authHeader(participant.id));

    expect(res.status).toBe(200);
    const ids = res.body.data.map((r: { id: string }) => r.id);
    expect(ids).toEqual([joined.id]);
    expect(ids).not.toContain(notConfirmed.id);
    expect(res.body.data[0]).toMatchObject({
      id: joined.id,
      status: 'CONFIRMED',
      creator: { id: creator.id },
    });
    expect(res.body.data[0]).toHaveProperty('availableSeats');
    expect(other.id).toBeTruthy();
  });

  it('returns an empty list when the participant has joined no rides', async () => {
    const participant = await createUser('joined-empty');
    const res = await request(app)
      .get('/api/v1/rides/joined')
      .set(authHeader(participant.id));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('fails closed without authentication (401)', async () => {
    const res = await request(app).get('/api/v1/rides/joined');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/rides/:rideId (participant access)', () => {
  it('lets a confirmed participant read the joined ride', async () => {
    const creator = await createUser('detail-participant-creator');
    const participant = await createUser('detail-participant');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.CONFIRMED,
      totalSeats: 3,
    });
    await createRequestFixture(ride.id, participant.id, {
      status: RideRequestStatus.ACCEPTED,
      confirmed: true,
    });

    const res = await request(app)
      .get(`/api/v1/rides/${ride.id}`)
      .set(authHeader(participant.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: ride.id,
      status: 'CONFIRMED',
      totalSeats: 3,
      availableSeats: 2,
      creator: { id: creator.id },
    });
  });

  it('still lets the creator read their own ride (unchanged)', async () => {
    const creator = await createUser('detail-creator-unchanged');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });

    const res = await request(app)
      .get(`/api/v1/rides/${ride.id}`)
      .set(authHeader(creator.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: ride.id,
      creator: { id: creator.id },
    });
  });

  it('rejects an unrelated authenticated user with 403 and no existence leak', async () => {
    const creator = await createUser('detail-unrelated-creator');
    const stranger = await createUser('detail-unrelated');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });

    const res = await request(app)
      .get(`/api/v1/rides/${ride.id}`)
      .set(authHeader(stranger.id));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
  });

  it('rejects a participant whose request was not confirmed with 403', async () => {
    const creator = await createUser('detail-pending-creator');
    const participant = await createUser('detail-pending');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });
    await createRequestFixture(ride.id, participant.id, {
      status: RideRequestStatus.PENDING,
    });

    const res = await request(app)
      .get(`/api/v1/rides/${ride.id}`)
      .set(authHeader(participant.id));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
  });

  it('returns 404 for an unknown ride', async () => {
    const user = await createUser('detail-missing-user');
    const res = await request(app)
      .get(`/api/v1/rides/${unique('ride')}`)
      .set(authHeader(user.id));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('fails closed without authentication (401)', async () => {
    const res = await request(app).get(`/api/v1/rides/${unique('ride')}`);
    expect(res.status).toBe(401);
  });
});
