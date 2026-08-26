/**
 * Phase 3.11 real Socket.io integration tests.
 *
 * End-to-end against the REAL Express app, REAL PostgreSQL, and a REAL
 * Socket.io server on an ephemeral port. Authentication uses the explicit
 * test/development authenticator (`x-test-user-id` handshake header) — the
 * same seam the REST boundary uses; a second server with the explicit
 * fail-closed default proves sockets still reject every connection without a
 * real authenticator.
 *
 * Covers: connection (success / unauthenticated / malformed / fail-closed),
 * rooms + isolation (a user only receives their own events), all six event
 * types delivered to the authoritative Phase 3.8 recipients, payload shape
 * (no Prisma records, no secrets), and persistence (offline users still
 * retrieve notifications through REST).
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import {
  io as createClient,
  type Socket as ClientSocket,
} from 'socket.io-client';
import { PricingType, RideStatus } from '@prisma/client';
import { createApp } from '../../app.js';
import { loadConfig } from '../../config/index.js';
import { createLogger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import {
  createTestAuthenticator,
  failClosedAuthenticator,
} from '../auth/http/auth.middleware.js';
import { expireRide } from '../ride/application/expire-ride.js';
import { resetEventPublisher } from './application/event-publisher.js';
import { attachSocketServer } from './infrastructure/socket-server.js';
import type { RealtimeEvent } from './domain/realtime-events.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
const logger = createLogger({ level: 'silent', pretty: false });
const authenticator = createTestAuthenticator();
const app = createApp({ config, logger, authenticator });

const httpServer: HttpServer = createServer(app);
const io = attachSocketServer(httpServer, { logger, authenticator });

// A second server with the explicit fail-closed authenticator: proves sockets
// reject every connection when no real authenticator is supplied. It must
// NOT activate the global publisher — only the primary server delivers
// events, so this proof server cannot hijack delivery.
const failClosedHttpServer: HttpServer = createServer();
const failClosedIo = attachSocketServer(failClosedHttpServer, {
  logger,
  authenticator: failClosedAuthenticator,
  activatePublisher: false,
});

let port = 0;
let failClosedPort = 0;

beforeAll(async () => {
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as AddressInfo).port;
  await new Promise<void>((resolve) => failClosedHttpServer.listen(0, resolve));
  failClosedPort = (failClosedHttpServer.address() as AddressInfo).port;
});

const RUN_ID = `rthttp_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let seq = 0;
function unique(label: string): string {
  seq += 1;
  return `${RUN_ID}_${label}_${seq}`;
}

const cleanup = {
  notificationIds: [] as string[],
  participantIds: [] as string[],
  requestIds: [] as string[],
  rideIds: [] as string[],
  locationIds: [] as string[],
  userIds: [] as string[],
};

afterAll(async () => {
  for (const socket of allSockets) {
    socket.disconnect();
  }
  io.close();
  failClosedIo.close();
  resetEventPublisher();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await new Promise<void>((resolve) =>
    failClosedHttpServer.close(() => resolve()),
  );
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

const allSockets: ClientSocket[] = [];

function connectClient(
  serverPort: number,
  userId: string | undefined,
): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = createClient(`http://localhost:${serverPort}`, {
      path: '/ws',
      extraHeaders: userId === undefined ? {} : { 'x-test-user-id': userId },
      forceNew: true,
      reconnection: false,
      timeout: 5000,
    });
    allSockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => reject(err));
  });
}

function waitForEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    // Bounded timeout (generous for CPU-contended parallel runs).
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}`)),
      5000,
    );
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload as T);
    });
  });
}

/** Asserts no event arrives within a bounded settle window (no arbitrary sleeps). */
function expectNoEvent(
  socket: ClientSocket,
  event: string,
  settleMs = 200,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, settleMs);
    socket.once(event, () => {
      clearTimeout(timer);
      reject(new Error(`Unexpected ${event} event received`));
    });
  });
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
  overrides: { status?: RideStatus; departureDateTime?: Date } = {},
) {
  const pickup = await createLocation(12.9716, 77.6412);
  const destination = await createLocation(12.9698, 77.75);
  const ride = await prisma.ride.create({
    data: {
      creatorId,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
      departureDateTime:
        overrides.departureDateTime ?? new Date(Date.now() + 3600_000),
      totalSeats: 3,
      vehicleType: 'car',
      discoveryRadiusKm: 10,
      pricingType: PricingType.STANDARD,
      pricePerKm: 4,
      status: overrides.status ?? RideStatus.PUBLISHED,
    },
  });
  cleanup.rideIds.push(ride.id);
  return ride;
}

async function createPendingRequest(rideId: string, userId: string) {
  const rideRequest = await prisma.rideRequest.create({
    data: { rideId, userId, requestedSeats: 1, status: 'PENDING' },
  });
  cleanup.requestIds.push(rideRequest.id);
  return rideRequest;
}

async function addConfirmedParticipant(rideId: string, userId: string) {
  const rideRequest = await prisma.rideRequest.create({
    data: {
      rideId,
      userId,
      requestedSeats: 1,
      status: 'ACCEPTED',
      resolvedAt: new Date(),
    },
  });
  cleanup.requestIds.push(rideRequest.id);
  const participant = await prisma.rideParticipant.create({
    data: {
      rideId,
      userId,
      requestId: rideRequest.id,
      seatsAllocated: 1,
      status: 'CONFIRMED',
    },
  });
  cleanup.participantIds.push(participant.id);
  return rideRequest;
}

const authHeader = (userId: string) => ({ 'x-test-user-id': userId });

// The full suite runs files in parallel workers; real Socket.io + PostgreSQL
// + supertest under CPU contention needs per-suite headroom over the
// 5s vitest default.
const SUITE_TIMEOUT = 10000;

describe(
  'connection authentication',
  () => {
    it('accepts an authenticated connection', async () => {
      const user = await createUser('conn-ok');
      await expect(connectClient(port, user.id)).resolves.toBeDefined();
    });

    it('rejects an unauthenticated connection with a safe error', async () => {
      await expect(connectClient(port, undefined)).rejects.toMatchObject({
        message: 'Authentication failed',
      });
    });

    it('rejects a malformed identity (fail closed)', async () => {
      await expect(connectClient(port, '   ')).rejects.toMatchObject({
        message: 'Authentication failed',
      });
    });

    it('rejects every connection without a real authenticator (fail closed)', async () => {
      // Valid test header, but the server uses the FAIL-CLOSED default.
      await expect(
        connectClient(failClosedPort, 'anyone'),
      ).rejects.toMatchObject({ message: 'Authentication failed' });
    });
  },
  SUITE_TIMEOUT,
);

describe(
  'event delivery and rooms',
  () => {
    it('RIDE_REQUESTED reaches the creator and nobody else', async () => {
      const creator = await createUser('rt-creator');
      const requester = await createUser('rt-requester');
      const stranger = await createUser('rt-stranger');
      const ride = await createRideFixture(creator.id);

      const [creatorSocket, requesterSocket, strangerSocket] =
        await Promise.all([
          connectClient(port, creator.id),
          connectClient(port, requester.id),
          connectClient(port, stranger.id),
        ]);

      // Register ALL listeners BEFORE triggering the operation: the publisher
      // emits after commit but before the HTTP response is sent, so a listener
      // attached after the request would race the (dropped) packet.
      const creatorEvent = waitForEvent<RealtimeEvent>(
        creatorSocket,
        'RIDE_REQUESTED',
      );
      const noRequesterEvent = expectNoEvent(requesterSocket, 'RIDE_REQUESTED');
      const noStrangerEvent = expectNoEvent(strangerSocket, 'RIDE_REQUESTED');

      const res = await request(app)
        .post(`/api/v1/rides/${ride.id}/requests`)
        .set(authHeader(requester.id))
        .send({ requestedSeats: 1 });
      expect(res.status).toBe(201);
      cleanup.requestIds.push(res.body.data.id);

      const event = await creatorEvent;
      expect(event.recipientUserId).toBe(creator.id);
      expect(event.rideId).toBe(ride.id);
      expect(event.requestId).toBe(res.body.data.id);

      // Isolation: the requester and the stranger received nothing.
      await noRequesterEvent;
      await noStrangerEvent;
    });

    it('REQUEST_ACCEPTED + RIDE_CONFIRMED reach requester and creator on first accept', async () => {
      const creator = await createUser('acc-creator');
      const requester = await createUser('acc-requester');
      const ride = await createRideFixture(creator.id);

      const [creatorSocket, requesterSocket] = await Promise.all([
        connectClient(port, creator.id),
        connectClient(port, requester.id),
      ]);

      const created = await request(app)
        .post(`/api/v1/rides/${ride.id}/requests`)
        .set(authHeader(requester.id))
        .send({ requestedSeats: 1 });
      expect(created.status).toBe(201);
      const requestId = created.body.data.id;
      cleanup.requestIds.push(requestId);

      const acceptedPromise = waitForEvent<RealtimeEvent>(
        requesterSocket,
        'REQUEST_ACCEPTED',
      );
      const confirmedForRequester = waitForEvent<RealtimeEvent>(
        requesterSocket,
        'RIDE_CONFIRMED',
      );
      const confirmedForCreator = waitForEvent<RealtimeEvent>(
        creatorSocket,
        'RIDE_CONFIRMED',
      );

      const acceptRes = await request(app)
        .post(`/api/v1/rides/${ride.id}/requests/${requestId}/accept`)
        .set(authHeader(creator.id));
      expect(acceptRes.status).toBe(200);
      cleanup.participantIds.push(acceptRes.body.data.participantId);

      const accepted = await acceptedPromise;
      expect(accepted.recipientUserId).toBe(requester.id);
      expect(accepted.requestId).toBe(requestId);

      const [requesterConfirmed, creatorConfirmed] = await Promise.all([
        confirmedForRequester,
        confirmedForCreator,
      ]);
      expect(requesterConfirmed.recipientUserId).toBe(requester.id);
      expect(creatorConfirmed.recipientUserId).toBe(creator.id);
    });

    it('REQUEST_REJECTED reaches the requester', async () => {
      const creator = await createUser('rej-creator');
      const requester = await createUser('rej-requester');
      const ride = await createRideFixture(creator.id);
      const rideRequest = await createPendingRequest(ride.id, requester.id);

      const requesterSocket = await connectClient(port, requester.id);
      const eventPromise = waitForEvent<RealtimeEvent>(
        requesterSocket,
        'REQUEST_REJECTED',
      );

      const res = await request(app)
        .post(`/api/v1/rides/${ride.id}/requests/${rideRequest.id}/reject`)
        .set(authHeader(creator.id));
      expect(res.status).toBe(200);

      const event = await eventPromise;
      expect(event.recipientUserId).toBe(requester.id);
      expect(event.rideId).toBe(ride.id);
    });

    it('RIDE_CANCELLED reaches the creator and confirmed participants', async () => {
      const creator = await createUser('can-creator');
      const participant = await createUser('can-participant');
      const ride = await createRideFixture(creator.id);
      await addConfirmedParticipant(ride.id, participant.id);

      const [creatorSocket, participantSocket] = await Promise.all([
        connectClient(port, creator.id),
        connectClient(port, participant.id),
      ]);
      const creatorEvent = waitForEvent<RealtimeEvent>(
        creatorSocket,
        'RIDE_CANCELLED',
      );
      const participantEvent = waitForEvent<RealtimeEvent>(
        participantSocket,
        'RIDE_CANCELLED',
      );

      const res = await request(app)
        .post(`/api/v1/rides/${ride.id}/cancel`)
        .set(authHeader(creator.id));
      expect(res.status).toBe(200);

      const [forCreator, forParticipant] = await Promise.all([
        creatorEvent,
        participantEvent,
      ]);
      expect(forCreator.recipientUserId).toBe(creator.id);
      expect(forParticipant.recipientUserId).toBe(participant.id);
    });

    it('RIDE_EXPIRED reaches the creator and confirmed participants', async () => {
      const creator = await createUser('exp-creator');
      const participant = await createUser('exp-participant');
      const ride = await createRideFixture(creator.id, {
        departureDateTime: new Date(Date.now() - 60_000),
      });
      await addConfirmedParticipant(ride.id, participant.id);

      const [creatorSocket, participantSocket] = await Promise.all([
        connectClient(port, creator.id),
        connectClient(port, participant.id),
      ]);
      const creatorEvent = waitForEvent<RealtimeEvent>(
        creatorSocket,
        'RIDE_EXPIRED',
      );
      const participantEvent = waitForEvent<RealtimeEvent>(
        participantSocket,
        'RIDE_EXPIRED',
      );

      // Expiration is a system operation (not a public REST endpoint).
      const result = await expireRide({
        rideId: ride.id,
        referenceTime: new Date(),
      });
      expect(result.statusChanged).toBe(true);

      const [forCreator, forParticipant] = await Promise.all([
        creatorEvent,
        participantEvent,
      ]);
      expect(forCreator.recipientUserId).toBe(creator.id);
      expect(forParticipant.recipientUserId).toBe(participant.id);
    });
  },
  SUITE_TIMEOUT,
);

describe(
  'payload security',
  () => {
    it('emits only the minimal contract — no Prisma records, no secrets', async () => {
      const creator = await createUser('payload-creator');
      const requester = await createUser('payload-requester');
      const ride = await createRideFixture(creator.id);

      const creatorSocket = await connectClient(port, creator.id);
      const eventPromise = waitForEvent<RealtimeEvent>(
        creatorSocket,
        'RIDE_REQUESTED',
      );

      const res = await request(app)
        .post(`/api/v1/rides/${ride.id}/requests`)
        .set(authHeader(requester.id))
        .send({ requestedSeats: 1 });
      expect(res.status).toBe(201);
      cleanup.requestIds.push(res.body.data.id);

      const event = await eventPromise;
      expect(Object.keys(event).sort()).toEqual(
        [
          'data',
          'eventId',
          'occurredAt',
          'recipientUserId',
          'requestId',
          'rideId',
          'type',
        ].sort(),
      );
      expect(event.type).toBe('RIDE_REQUESTED');
      expect(event.eventId).toBeTruthy();
      expect(event.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
      expect(event.data).toEqual({
        title: expect.any(String),
        body: expect.any(String),
      });
      // No raw database fields, credentials, or internal details leak.
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain('password');
      expect(serialized).not.toContain('"hash"');
      expect(serialized).not.toContain('P2002');
      expect(event.data).not.toHaveProperty('userId');
    });
  },
  SUITE_TIMEOUT,
);

describe(
  'persistence remains authoritative',
  () => {
    it('an offline recipient still retrieves the notification through REST', async () => {
      const creator = await createUser('offline-creator');
      const requester = await createUser('offline-requester');
      const ride = await createRideFixture(creator.id);

      // Creator is NOT connected to the socket server.
      const res = await request(app)
        .post(`/api/v1/rides/${ride.id}/requests`)
        .set(authHeader(requester.id))
        .send({ requestedSeats: 1 });
      expect(res.status).toBe(201);
      cleanup.requestIds.push(res.body.data.id);

      const notifications = await request(app)
        .get('/api/v1/notifications')
        .set(authHeader(creator.id));
      expect(notifications.status).toBe(200);
      expect(notifications.body.data.notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'RIDE_REQUESTED',
            rideId: ride.id,
            requestId: res.body.data.id,
          }),
        ]),
      );
    });
  },
  SUITE_TIMEOUT,
);
