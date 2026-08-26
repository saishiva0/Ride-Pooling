/**
 * Phase 3.11 transaction-safety integration tests (real PostgreSQL).
 *
 * Proves the mandatory "commit THEN publish" behavior for all five Ride
 * Engine operations: a successful transaction publishes exactly the
 * authoritative recipients' events; a failed/rolled-back transaction (or an
 * ineligible no-op) publishes NOTHING.
 *
 * A capturing publisher is registered (the same registry the Socket.io
 * server activates); the use cases run with their REAL default wiring, so
 * events flow through the exact production path — after `await
 * runTransaction(...)` resolves.
 */
import 'dotenv/config';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { PricingType, RideStatus } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { createRideRequest } from '../../ride/application/create-ride-request.js';
import { acceptRideRequest } from '../../ride/application/accept-ride-request.js';
import { rejectRideRequest } from '../../ride/application/reject-ride-request.js';
import { cancelRide } from '../../ride/application/cancel-ride.js';
import { expireRide } from '../../ride/application/expire-ride.js';
import type { RealtimeEvent } from '../domain/realtime-events.js';
import { resetEventPublisher, setEventPublisher } from './event-publisher.js';

const RUN_ID = `rtsafe_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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

// Deterministic capture: no sockets involved — the publisher registry is the
// same seam the Socket.io server activates, and the use cases run with their
// real default wiring.
let captured: RealtimeEvent[] = [];
setEventPublisher({
  publish: async (events) => {
    captured.push(...events);
  },
});

afterEach(() => {
  captured = [];
});

afterAll(async () => {
  resetEventPublisher();

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

/** Adds a CONFIRMED participant (accepted request + participant row). */
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

describe('transaction → commit → publish (success paths)', () => {
  it('RIDE_REQUESTED → creator after request creation commits', async () => {
    const creator = await createUser('rt-creator');
    const requester = await createUser('rt-requester');
    const ride = await createRideFixture(creator.id);

    const result = await createRideRequest({
      rideId: ride.id,
      requesterId: requester.id,
      requestedSeats: 1,
    });
    cleanup.requestIds.push(result.id);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      type: 'RIDE_REQUESTED',
      recipientUserId: creator.id,
      rideId: ride.id,
      requestId: result.id,
    });
  });

  it('REQUEST_ACCEPTED → requester and RIDE_CONFIRMED → creator + requester on first accept', async () => {
    const creator = await createUser('rt-accept-creator');
    const requester = await createUser('rt-accept-requester');
    const ride = await createRideFixture(creator.id);
    const rideRequest = await createPendingRequest(ride.id, requester.id);

    const result = await acceptRideRequest({
      requestId: rideRequest.id,
      actorId: creator.id,
    });
    cleanup.participantIds.push(result.participantId);

    const types = captured.map((e) => e.type).sort();
    expect(types).toEqual([
      'REQUEST_ACCEPTED',
      'RIDE_CONFIRMED',
      'RIDE_CONFIRMED',
    ]);
    expect(captured.filter((e) => e.type === 'REQUEST_ACCEPTED')).toEqual([
      expect.objectContaining({ recipientUserId: requester.id }),
    ]);
    const confirmedRecipients = captured
      .filter((e) => e.type === 'RIDE_CONFIRMED')
      .map((e) => e.recipientUserId)
      .sort();
    expect(confirmedRecipients).toEqual([creator.id, requester.id].sort());
  });

  it('REQUEST_REJECTED → requester after rejection commits', async () => {
    const creator = await createUser('rt-reject-creator');
    const requester = await createUser('rt-reject-requester');
    const ride = await createRideFixture(creator.id);
    const rideRequest = await createPendingRequest(ride.id, requester.id);

    await rejectRideRequest({ requestId: rideRequest.id, actorId: creator.id });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      type: 'REQUEST_REJECTED',
      recipientUserId: requester.id,
      rideId: ride.id,
      requestId: rideRequest.id,
    });
  });

  it('RIDE_CANCELLED → creator + confirmed participants after cancellation commits', async () => {
    const creator = await createUser('rt-cancel-creator');
    const participant = await createUser('rt-cancel-participant');
    const ride = await createRideFixture(creator.id);
    await addConfirmedParticipant(ride.id, participant.id);

    await cancelRide({ rideId: ride.id, actorId: creator.id });

    const recipients = captured.map((e) => e.recipientUserId).sort();
    expect(captured.every((e) => e.type === 'RIDE_CANCELLED')).toBe(true);
    expect(recipients).toEqual([creator.id, participant.id].sort());
  });

  it('RIDE_EXPIRED → creator + confirmed participants after expiration commits', async () => {
    const creator = await createUser('rt-expire-creator');
    const participant = await createUser('rt-expire-participant');
    const ride = await createRideFixture(creator.id, {
      departureDateTime: new Date(Date.now() - 60_000),
    });
    await addConfirmedParticipant(ride.id, participant.id);

    await expireRide({ rideId: ride.id, referenceTime: new Date() });

    const recipients = captured.map((e) => e.recipientUserId).sort();
    expect(captured.every((e) => e.type === 'RIDE_EXPIRED')).toBe(true);
    expect(recipients).toEqual([creator.id, participant.id].sort());
  });
});

describe('transaction → failure → NO events', () => {
  it('a rejected request creation (non-requestable ride) publishes nothing', async () => {
    const creator = await createUser('rt-fail-creator');
    const requester = await createUser('rt-fail-requester');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.DRAFT,
    });

    await expect(
      createRideRequest({ rideId: ride.id, requesterId: requester.id }),
    ).rejects.toMatchObject({ statusCode: 422 });

    expect(captured).toEqual([]);
  });

  it('a conflict (request not pending) publishes nothing', async () => {
    const creator = await createUser('rt-conflict-creator');
    const requester = await createUser('rt-conflict-requester');
    const ride = await createRideFixture(creator.id);
    const rideRequest = await createPendingRequest(ride.id, requester.id);
    await rejectRideRequest({ requestId: rideRequest.id, actorId: creator.id });
    // Clear the successful rejection's events: this test asserts the FAILED
    // accept publishes nothing.
    captured = [];

    await expect(
      acceptRideRequest({ requestId: rideRequest.id, actorId: creator.id }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(captured).toEqual([]);
  });

  it('a non-creator rejection (403) publishes nothing', async () => {
    const creator = await createUser('rt-403-creator');
    const requester = await createUser('rt-403-requester');
    const stranger = await createUser('rt-403-stranger');
    const ride = await createRideFixture(creator.id);
    const rideRequest = await createPendingRequest(ride.id, requester.id);

    await expect(
      rejectRideRequest({ requestId: rideRequest.id, actorId: stranger.id }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(captured).toEqual([]);
  });

  it('a failed cancellation (terminal ride) publishes nothing', async () => {
    const creator = await createUser('rt-term-creator');
    const ride = await createRideFixture(creator.id, {
      status: RideStatus.CANCELLED,
    });

    await expect(
      cancelRide({ rideId: ride.id, actorId: creator.id }),
    ).rejects.toMatchObject({ statusCode: 422 });

    expect(captured).toEqual([]);
  });

  it('an ineligible expiration (no-op) publishes nothing', async () => {
    const creator = await createUser('rt-noop-creator');
    const ride = await createRideFixture(creator.id, {
      departureDateTime: new Date(Date.now() + 3600_000),
    });

    const result = await expireRide({
      rideId: ride.id,
      referenceTime: new Date(),
    });

    expect(result.statusChanged).toBe(false);
    expect(captured).toEqual([]);
  });
});
