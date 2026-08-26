/**
 * Phase 3.7 real-database / integration tests for ride cancellation and
 * expiration.
 *
 * Exercises `cancelRide` / `expireRide` end-to-end against the real
 * PostgreSQL database: status transitions, `RideStatusHistory` rows (creator
 * actor for cancel, system actor for expire), preservation of creator /
 * locations / confirmed participants, discovery regression (a cancelled or
 * expired ride no longer appears in discovery), idempotent expiration,
 * repeated-cancellation rejection without duplicate history, and the
 * cancellation↔expiration / cancellation↔cancellation / expiration↔expiration
 * races (verified against final database state).
 *
 * Fixtures use a base point far (>400 km) from the Phase 3.3 discovery /
 * Phase 3.4 matching Bengaluru fixtures and offset from the Phase 3.6
 * Hyderabad fixtures, so these rides never compete for discovery result
 * limits. Discovery regression queries are made from this file's own base
 * point with an explicit high limit, so assertions are scoped to this file's
 * ride ids.
 *
 * Requires a reachable dev database with the Phase 2 migration applied.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ParticipantStatus,
  PricingType,
  RideRequestStatus,
  RideStatus,
} from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import {
  AuthorizationError,
  BusinessRuleError,
  NotFoundError,
} from '../../../lib/errors.js';
import { discoverRides } from '../application/discover-rides.js';
import {
  cancelRide,
  RIDE_CANCELLED_REASON,
} from '../application/cancel-ride.js';
import { expireRide, RIDE_EXPIRED_REASON } from '../application/expire-ride.js';
import type { RideStatusHistory } from '@prisma/client';

const RUN_ID = `lifetest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  // Phase 3.8: notifications reference users with ON DELETE RESTRICT, so
  // they must be removed before the users that own them.
  await prisma.notification.deleteMany({
    where: { userId: { in: cleanup.userIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.$disconnect();
});

// Fixed reference time for every expiration test — never wall-clock.
const REF = new Date('2026-08-20T10:00:00.000Z');
const DEPARTURE_PAST = new Date('2026-08-19T10:00:00.000Z');
const DEPARTURE_FUTURE = new Date('2026-08-21T10:00:00.000Z');

// This file's own base point (Hyderabad-area, offset from the Phase 3.6
// fixtures) so discovery regression is meaningful and non-interfering.
const BASE = { lat: 17.45, lon: 78.35 };

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
    status: RideStatus;
    departureDateTime?: Date;
    totalSeats?: number;
  },
) {
  const pickup = await createLocation(BASE.lat, BASE.lon);
  const destination = await createLocation(17.05, 78.0);
  const ride = await prisma.ride.create({
    data: {
      creatorId,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
      departureDateTime: options.departureDateTime ?? DEPARTURE_FUTURE,
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
      status: RideRequestStatus.ACCEPTED,
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
      status: ParticipantStatus.CONFIRMED,
    },
  });
  cleanup.participantIds.push(participant.id);
}

async function discoverAtBase(): Promise<string[]> {
  const results = await discoverRides({
    latitude: BASE.lat,
    longitude: BASE.lon,
    radiusMeters: 2000,
    limit: 100,
  });
  return results.map((r) => r.id);
}

async function historyFor(rideId: string): Promise<RideStatusHistory[]> {
  return prisma.rideStatusHistory.findMany({
    where: { rideId },
    orderBy: { createdAt: 'asc' },
  });
}

describe('cancelRide — real database integration', () => {
  it('cancels a PUBLISHED ride: status, history, preserved relationships, and non-discoverability', async () => {
    const creator = await createUser('cancel-published');
    const { ride, pickup, destination } = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });

    // The PUBLISHED ride is discoverable from its own base point.
    expect(await discoverAtBase()).toContain(ride.id);

    const result = await cancelRide({ rideId: ride.id, actorId: creator.id });
    expect(result.status).toBe(RideStatus.CANCELLED);

    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(persisted.status).toBe(RideStatus.CANCELLED);
    expect(persisted.creatorId).toBe(creator.id);
    expect(persisted.pickupLocationId).toBe(pickup.id);
    expect(persisted.destinationLocationId).toBe(destination.id);

    // Creator and Location rows remain (nothing is deleted).
    expect(
      await prisma.user.findUnique({ where: { id: creator.id } }),
    ).not.toBeNull();
    expect(
      await prisma.location.findUnique({ where: { id: pickup.id } }),
    ).not.toBeNull();
    expect(
      await prisma.location.findUnique({ where: { id: destination.id } }),
    ).not.toBeNull();

    const history = await historyFor(ride.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      rideId: ride.id,
      fromStatus: RideStatus.PUBLISHED,
      toStatus: RideStatus.CANCELLED,
      changedByUserId: creator.id,
      reason: RIDE_CANCELLED_REASON,
    });

    // A cancelled ride is no longer discoverable (discovery only considers
    // PUBLISHED/CONFIRMED — Phase 3.7 §7).
    expect(await discoverAtBase()).not.toContain(ride.id);
  });

  it('cancels a CONFIRMED ride and preserves its confirmed participant', async () => {
    const creator = await createUser('cancel-confirmed');
    const requester = await createUser('cancel-confirmed-passenger');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.CONFIRMED,
    });
    await addConfirmedParticipant(ride.id, requester.id, 1);

    const result = await cancelRide({ rideId: ride.id, actorId: creator.id });
    expect(result.status).toBe(RideStatus.CANCELLED);

    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(persisted.status).toBe(RideStatus.CANCELLED);

    // Participants and requests remain historically represented — nothing is
    // deleted, and no seat-release semantics are invented (Phase 3.7 §7).
    const participant = await prisma.rideParticipant.findFirst({
      where: { rideId: ride.id },
    });
    expect(participant).not.toBeNull();
    expect(participant?.status).toBe(ParticipantStatus.CONFIRMED);
    const request = await prisma.rideRequest.findFirst({
      where: { rideId: ride.id },
    });
    expect(request).not.toBeNull();

    expect(await discoverAtBase()).not.toContain(ride.id);
  });

  it('cancels a DRAFT ride', async () => {
    const creator = await createUser('cancel-draft');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.DRAFT,
    });
    const result = await cancelRide({ rideId: ride.id, actorId: creator.id });
    expect(result.status).toBe(RideStatus.CANCELLED);
    expect((await historyFor(ride.id))[0]?.toStatus).toBe(RideStatus.CANCELLED);
  });

  it('cancels an IN_PROGRESS ride', async () => {
    const creator = await createUser('cancel-inprogress');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.IN_PROGRESS,
    });
    const result = await cancelRide({ rideId: ride.id, actorId: creator.id });
    expect(result.status).toBe(RideStatus.CANCELLED);
    expect((await historyFor(ride.id))[0]?.toStatus).toBe(RideStatus.CANCELLED);
  });

  it('rejects a non-creator actor without mutating anything', async () => {
    const creator = await createUser('cancel-authz-creator');
    const stranger = await createUser('cancel-authz-stranger');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });

    await expect(
      cancelRide({ rideId: ride.id, actorId: stranger.id }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(persisted.status).toBe(RideStatus.PUBLISHED);
    expect(await historyFor(ride.id)).toHaveLength(0);
  });

  it('rejects a missing ride', async () => {
    await expect(
      cancelRide({ rideId: 'missing-ride', actorId: 'anyone' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects repeated cancellation without duplicate history', async () => {
    const creator = await createUser('cancel-repeat');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });

    await cancelRide({ rideId: ride.id, actorId: creator.id });
    await expect(
      cancelRide({ rideId: ride.id, actorId: creator.id }),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(persisted.status).toBe(RideStatus.CANCELLED);
    const history = await historyFor(ride.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.toStatus).toBe(RideStatus.CANCELLED);
  });
});

describe('expireRide — real database integration', () => {
  it('expires an eligible PUBLISHED ride: status, history, and non-discoverability', async () => {
    const creator = await createUser('expire-eligible');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
      departureDateTime: DEPARTURE_PAST,
    });

    expect(await discoverAtBase()).toContain(ride.id);

    const result = await expireRide({ rideId: ride.id, referenceTime: REF });
    expect(result).toMatchObject({
      rideId: ride.id,
      status: RideStatus.EXPIRED,
      statusChanged: true,
    });

    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(persisted.status).toBe(RideStatus.EXPIRED);

    const history = await historyFor(ride.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      rideId: ride.id,
      fromStatus: RideStatus.PUBLISHED,
      toStatus: RideStatus.EXPIRED,
      changedByUserId: null,
      reason: RIDE_EXPIRED_REASON,
    });

    // An expired ride is no longer discoverable.
    expect(await discoverAtBase()).not.toContain(ride.id);
  });

  it('is idempotent: a second expiration creates no duplicate history', async () => {
    const creator = await createUser('expire-idempotent');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
      departureDateTime: DEPARTURE_PAST,
    });

    await expireRide({ rideId: ride.id, referenceTime: REF });
    const second = await expireRide({ rideId: ride.id, referenceTime: REF });

    expect(second).toMatchObject({
      rideId: ride.id,
      status: RideStatus.EXPIRED,
      statusChanged: false,
    });
    expect(await historyFor(ride.id)).toHaveLength(1);
  });

  it('leaves ineligible rides unchanged', async () => {
    // CONFIRMED rides are never auto-expired (ride-lifecycle.md §5).
    const confirmedCreator = await createUser('expire-confirmed');
    const { ride: confirmed } = await createRideFixture(confirmedCreator.id, {
      status: RideStatus.CONFIRMED,
      departureDateTime: DEPARTURE_PAST,
    });
    const confirmedResult = await expireRide({
      rideId: confirmed.id,
      referenceTime: REF,
    });
    expect(confirmedResult).toMatchObject({
      rideId: confirmed.id,
      status: RideStatus.CONFIRMED,
      statusChanged: false,
    });

    // Future departure → not eligible.
    const futureCreator = await createUser('expire-future');
    const { ride: future } = await createRideFixture(futureCreator.id, {
      status: RideStatus.PUBLISHED,
      departureDateTime: DEPARTURE_FUTURE,
    });
    const futureResult = await expireRide({
      rideId: future.id,
      referenceTime: REF,
    });
    expect(futureResult).toMatchObject({
      rideId: future.id,
      status: RideStatus.PUBLISHED,
      statusChanged: false,
    });

    // An already CANCELLED ride does not expire.
    const cancelledCreator = await createUser('expire-cancelled');
    const { ride: cancelled } = await createRideFixture(cancelledCreator.id, {
      status: RideStatus.PUBLISHED,
      departureDateTime: DEPARTURE_PAST,
    });
    await cancelRide({ rideId: cancelled.id, actorId: cancelledCreator.id });
    const cancelledResult = await expireRide({
      rideId: cancelled.id,
      referenceTime: REF,
    });
    expect(cancelledResult).toMatchObject({
      rideId: cancelled.id,
      status: RideStatus.CANCELLED,
      statusChanged: false,
    });

    expect(await historyFor(confirmed.id)).toHaveLength(0);
    expect(await historyFor(future.id)).toHaveLength(0);
    expect(await historyFor(cancelled.id)).toHaveLength(1); // the cancellation only
  });

  it('respects an explicit grace window policy input (OD-002 open)', async () => {
    const creator = await createUser('expire-grace');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
      departureDateTime: DEPARTURE_PAST,
    });

    // A large grace window keeps the ride eligible to stay PUBLISHED.
    const result = await expireRide({
      rideId: ride.id,
      referenceTime: REF,
      graceWindowMs: 48 * 60 * 60 * 1000, // 48h — departure was ~24h before REF
    });
    expect(result).toMatchObject({
      rideId: ride.id,
      status: RideStatus.PUBLISHED,
      statusChanged: false,
    });
    expect(await historyFor(ride.id)).toHaveLength(0);
  });

  it('rejects a missing ride', async () => {
    await expect(
      expireRide({ rideId: 'missing-ride', referenceTime: REF }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('lifecycle concurrency — real database integration', () => {
  it('two concurrent cancellations produce exactly one CANCELLED ride', async () => {
    const creator = await createUser('race-cancel-cancel');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });

    const [a, b] = await Promise.allSettled([
      cancelRide({ rideId: ride.id, actorId: creator.id }),
      cancelRide({ rideId: ride.id, actorId: creator.id }),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      BusinessRuleError,
    );

    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(persisted.status).toBe(RideStatus.CANCELLED);
    // Exactly one CANCELLED history row — the loser never wrote duplicate
    // history (its transaction saw the fresh CANCELLED state under the lock).
    const history = await historyFor(ride.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.toStatus).toBe(RideStatus.CANCELLED);
  });

  it('a concurrent cancellation + expiration ends in exactly one terminal state', async () => {
    const creator = await createUser('race-cancel-expire');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
      departureDateTime: DEPARTURE_PAST,
    });

    const [cancelOutcome, expireOutcome] = await Promise.allSettled([
      cancelRide({ rideId: ride.id, actorId: creator.id }),
      expireRide({ rideId: ride.id, referenceTime: REF }),
    ]);

    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    // Exactly one terminal state — never PUBLISHED, never both.
    expect([RideStatus.CANCELLED, RideStatus.EXPIRED]).toContain(
      persisted.status,
    );

    const history = await historyFor(ride.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.toStatus).toBe(persisted.status);

    if (persisted.status === RideStatus.CANCELLED) {
      expect(cancelOutcome.status).toBe('fulfilled');
      expect(expireOutcome.status).toBe('fulfilled');
      expect(
        (expireOutcome as PromiseFulfilledResult<{ statusChanged: boolean }>)
          .value.statusChanged,
      ).toBe(false);
    } else {
      expect(cancelOutcome.status).toBe('rejected');
      expect((cancelOutcome as PromiseRejectedResult).reason).toBeInstanceOf(
        BusinessRuleError,
      );
      expect(expireOutcome.status).toBe('fulfilled');
      expect(
        (expireOutcome as PromiseFulfilledResult<{ statusChanged: boolean }>)
          .value.statusChanged,
      ).toBe(true);
    }
  });

  it('two concurrent expirations produce exactly one EXPIRED transition', async () => {
    const creator = await createUser('race-expire-expire');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
      departureDateTime: DEPARTURE_PAST,
    });

    const [a, b] = await Promise.allSettled([
      expireRide({ rideId: ride.id, referenceTime: REF }),
      expireRide({ rideId: ride.id, referenceTime: REF }),
    ]);

    const changed = [a, b].filter(
      (r) => r.status === 'fulfilled' && r.value.statusChanged === true,
    );
    const unchanged = [a, b].filter(
      (r) => r.status === 'fulfilled' && r.value.statusChanged === false,
    );
    expect(changed).toHaveLength(1);
    expect(unchanged).toHaveLength(1);

    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(persisted.status).toBe(RideStatus.EXPIRED);
    const history = await historyFor(ride.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.toStatus).toBe(RideStatus.EXPIRED);
  });
});
