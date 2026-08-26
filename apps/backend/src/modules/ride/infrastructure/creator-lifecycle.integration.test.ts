/**
 * Phase 3.17 real-database / integration tests for the creator lifecycle
 * (publish / start / complete) and the creator read path (list / detail).
 *
 * Exercises the use cases end-to-end against the real PostgreSQL database:
 * status transitions, `RideStatusHistory` rows (actor = creator for all
 * three), preservation of creator / locations / confirmed participants,
 * discovery regression (a published ride becomes discoverable), illegal-state
 * rejection without duplicate history, creator authorization, rollback
 * atomicity (an injected history-write failure leaves the ride unchanged),
 * and the publish↔publish / start↔start / complete↔complete races (verified
 * against final database state).
 *
 * Notification behavior: publish/start/complete create NO notifications (the
 * existing six-event mapping has no RIDE_PUBLISHED/STARTED/COMPLETED drafts),
 * asserted here by checking the notification table.
 *
 * The creator read path tests cover: list ordering (departureDateTime ASC),
 * availableSeats against real CONFIRMED participants, creator-only detail
 * authorization, and missing-ride 404 without leaking existence.
 *
 * Fixtures use a base point offset from the Phase 3.3/3.4 Bengaluru and
 * Phase 3.6/3.7 Hyderabad fixtures, so these rides never compete for
 * discovery result limits. Discovery regression queries are made from this
 * file's own base point with an explicit high limit, so assertions are
 * scoped to this file's ride ids.
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
  InternalError,
  NotFoundError,
} from '../../../lib/errors.js';
import { discoverRides } from '../application/discover-rides.js';
import {
  publishRide,
  RIDE_PUBLISHED_REASON,
} from '../application/publish-ride.js';
import { startRide, RIDE_STARTED_REASON } from '../application/start-ride.js';
import {
  completeRide,
  RIDE_COMPLETED_REASON,
} from '../application/complete-ride.js';
import { listCreatorRides } from '../application/list-creator-rides.js';
import { getCreatorRide } from '../application/get-ride-detail.js';
import { createRideLifecyclePersistence } from '../application/ride-lifecycle.js';
import type { RideStatusHistory } from '@prisma/client';

const RUN_ID = `creator17_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  await prisma.notification.deleteMany({
    where: { userId: { in: cleanup.userIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.$disconnect();
});

// This file's own base point (off Bengaluru proper) so discovery regression
// is meaningful and non-interfering.
const BASE = { lat: 12.9, lon: 77.5 };
const DEPARTURE_FUTURE = new Date('2026-08-21T10:00:00.000Z');

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
  const destination = await createLocation(13.0, 77.6);
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

describe('publishRide — real database integration', () => {
  it('publishes a DRAFT ride: status, history, discoverability, and no notification', async () => {
    const creator = await createUser('publish-draft');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.DRAFT,
    });
    // A DRAFT ride is not discoverable.
    expect(await discoverAtBase()).not.toContain(ride.id);

    const result = await publishRide({ rideId: ride.id, actorId: creator.id });
    expect(result).toMatchObject({
      rideId: ride.id,
      status: RideStatus.PUBLISHED,
    });

    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(persisted.status).toBe(RideStatus.PUBLISHED);

    const history = await historyFor(ride.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      rideId: ride.id,
      fromStatus: RideStatus.DRAFT,
      toStatus: RideStatus.PUBLISHED,
      changedByUserId: creator.id,
      reason: RIDE_PUBLISHED_REASON,
    });

    // Publishing makes the ride discoverable (ride-lifecycle.md §2.2).
    expect(await discoverAtBase()).toContain(ride.id);

    // No notification is created (no RIDE_PUBLISHED event in the mapping).
    expect(
      await prisma.notification.count({ where: { userId: creator.id } }),
    ).toBe(0);
  });

  it('rejects repeated publication without duplicate history', async () => {
    const creator = await createUser('publish-repeat');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.DRAFT,
    });

    await publishRide({ rideId: ride.id, actorId: creator.id });
    await expect(
      publishRide({ rideId: ride.id, actorId: creator.id }),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(persisted.status).toBe(RideStatus.PUBLISHED);
    expect(await historyFor(ride.id)).toHaveLength(1);
  });

  it('rejects a non-creator actor without mutating anything', async () => {
    const creator = await createUser('publish-authz-creator');
    const stranger = await createUser('publish-authz-stranger');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.DRAFT,
    });

    await expect(
      publishRide({ rideId: ride.id, actorId: stranger.id }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(persisted.status).toBe(RideStatus.DRAFT);
    expect(await historyFor(ride.id)).toHaveLength(0);
  });

  it('rejects a missing ride', async () => {
    await expect(
      publishRide({ rideId: unique('missing'), actorId: 'anyone' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('startRide — real database integration', () => {
  it.each([RideStatus.PUBLISHED, RideStatus.CONFIRMED])(
    'starts a %s ride: status, history, and preserved participants',
    async (status) => {
      const creator = await createUser(`start-${status.toLowerCase()}`);
      const passenger = await createUser(
        `start-passenger-${status.toLowerCase()}`,
      );
      const { ride } = await createRideFixture(creator.id, { status });
      if (status === RideStatus.CONFIRMED) {
        await addConfirmedParticipant(ride.id, passenger.id, 1);
      }

      const result = await startRide({ rideId: ride.id, actorId: creator.id });
      expect(result).toMatchObject({
        rideId: ride.id,
        status: RideStatus.IN_PROGRESS,
      });

      const persisted = await prisma.ride.findUniqueOrThrow({
        where: { id: ride.id },
      });
      expect(persisted.status).toBe(RideStatus.IN_PROGRESS);

      const history = await historyFor(ride.id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        rideId: ride.id,
        fromStatus: status,
        toStatus: RideStatus.IN_PROGRESS,
        changedByUserId: creator.id,
        reason: RIDE_STARTED_REASON,
      });

      // Confirmed participants are preserved (nothing is deleted/cleared).
      if (status === RideStatus.CONFIRMED) {
        const participant = await prisma.rideParticipant.findFirst({
          where: { rideId: ride.id },
        });
        expect(participant?.status).toBe(ParticipantStatus.CONFIRMED);
      }

      // No notification is created (no RIDE_STARTED event in the mapping).
      expect(
        await prisma.notification.count({ where: { userId: creator.id } }),
      ).toBe(0);
    },
  );

  it('rejects starting a DRAFT or already-IN_PROGRESS ride without writes', async () => {
    const creator = await createUser('start-invalid');
    const { ride: draft } = await createRideFixture(creator.id, {
      status: RideStatus.DRAFT,
    });
    const { ride: running } = await createRideFixture(creator.id, {
      status: RideStatus.IN_PROGRESS,
    });

    await expect(
      startRide({ rideId: draft.id, actorId: creator.id }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(
      startRide({ rideId: running.id, actorId: creator.id }),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    expect(
      (await prisma.ride.findUniqueOrThrow({ where: { id: draft.id } })).status,
    ).toBe(RideStatus.DRAFT);
    expect(
      (await prisma.ride.findUniqueOrThrow({ where: { id: running.id } }))
        .status,
    ).toBe(RideStatus.IN_PROGRESS);
    expect(await historyFor(draft.id)).toHaveLength(0);
    expect(await historyFor(running.id)).toHaveLength(0);
  });

  it('rejects a non-creator actor without mutating anything', async () => {
    const creator = await createUser('start-authz-creator');
    const stranger = await createUser('start-authz-stranger');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });

    await expect(
      startRide({ rideId: ride.id, actorId: stranger.id }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(persisted.status).toBe(RideStatus.PUBLISHED);
    expect(await historyFor(ride.id)).toHaveLength(0);
  });
});

describe('completeRide — real database integration', () => {
  it('completes an IN_PROGRESS ride: status, history, preserved participants, and no notification', async () => {
    const creator = await createUser('complete-inprogress');
    const passenger = await createUser('complete-passenger');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.IN_PROGRESS,
    });
    await addConfirmedParticipant(ride.id, passenger.id, 1);

    const result = await completeRide({ rideId: ride.id, actorId: creator.id });
    expect(result).toMatchObject({
      rideId: ride.id,
      status: RideStatus.COMPLETED,
    });

    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(persisted.status).toBe(RideStatus.COMPLETED);

    const history = await historyFor(ride.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      rideId: ride.id,
      fromStatus: RideStatus.IN_PROGRESS,
      toStatus: RideStatus.COMPLETED,
      changedByUserId: creator.id,
      reason: RIDE_COMPLETED_REASON,
    });

    // Confirmed participants remain historically represented.
    const participant = await prisma.rideParticipant.findFirst({
      where: { rideId: ride.id },
    });
    expect(participant).not.toBeNull();
    expect(participant?.status).toBe(ParticipantStatus.CONFIRMED);

    // No notification is created (no RIDE_COMPLETED event in the mapping).
    expect(
      await prisma.notification.count({ where: { userId: creator.id } }),
    ).toBe(0);
  });

  it('rejects completing a ride that is not IN_PROGRESS', async () => {
    const creator = await createUser('complete-invalid');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });

    await expect(
      completeRide({ rideId: ride.id, actorId: creator.id }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(
      (await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } })).status,
    ).toBe(RideStatus.PUBLISHED);
    expect(await historyFor(ride.id)).toHaveLength(0);
  });

  it('rejects a non-creator actor without mutating anything', async () => {
    const creator = await createUser('complete-authz-creator');
    const stranger = await createUser('complete-authz-stranger');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.IN_PROGRESS,
    });

    await expect(
      completeRide({ rideId: ride.id, actorId: stranger.id }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(
      (await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } })).status,
    ).toBe(RideStatus.IN_PROGRESS);
    expect(await historyFor(ride.id)).toHaveLength(0);
  });
});

describe('creator journey — publish → start → complete', () => {
  it('walks the full lifecycle with a chained, authored history', async () => {
    const creator = await createUser('journey');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.DRAFT,
    });

    await publishRide({ rideId: ride.id, actorId: creator.id });
    await startRide({ rideId: ride.id, actorId: creator.id });
    const completed = await completeRide({
      rideId: ride.id,
      actorId: creator.id,
    });

    expect(completed.status).toBe(RideStatus.COMPLETED);
    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(persisted.status).toBe(RideStatus.COMPLETED);

    const history = await historyFor(ride.id);
    expect(history.map((h) => h.toStatus)).toEqual([
      RideStatus.PUBLISHED,
      RideStatus.IN_PROGRESS,
      RideStatus.COMPLETED,
    ]);
    expect(history.map((h) => h.changedByUserId)).toEqual([
      creator.id,
      creator.id,
      creator.id,
    ]);
    expect(history.map((h) => h.reason)).toEqual([
      RIDE_PUBLISHED_REASON,
      RIDE_STARTED_REASON,
      RIDE_COMPLETED_REASON,
    ]);

    // COMPLETED is terminal: no further transition is possible.
    await expect(
      completeRide({ rideId: ride.id, actorId: creator.id }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(await historyFor(ride.id)).toHaveLength(3);
  });
});

describe('creator lifecycle — rollback atomicity', () => {
  it('rolls back the whole transaction when the history write fails', async () => {
    const creator = await createUser('rollback');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.DRAFT,
    });

    // Inject tampered persistence: the real transaction, but the status
    // history write throws AFTER the ride status update succeeds.
    await expect(
      publishRide(
        { rideId: ride.id, actorId: creator.id },
        {
          runTransaction: (work) =>
            prisma.$transaction(async (tx) => {
              const persistence = createRideLifecyclePersistence(tx);
              persistence.createStatusHistory = async () => {
                throw new Error('injected history write failure');
              };
              return work(persistence);
            }),
        },
      ),
    ).rejects.toBeInstanceOf(InternalError);

    // The rollback left the ride unchanged: still DRAFT, no history row.
    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(persisted.status).toBe(RideStatus.DRAFT);
    expect(await historyFor(ride.id)).toHaveLength(0);
  });
});

describe('creator lifecycle — concurrency', () => {
  it('two concurrent publishes produce exactly one PUBLISHED transition', async () => {
    const creator = await createUser('race-publish');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.DRAFT,
    });

    const [a, b] = await Promise.allSettled([
      publishRide({ rideId: ride.id, actorId: creator.id }),
      publishRide({ rideId: ride.id, actorId: creator.id }),
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
    expect(persisted.status).toBe(RideStatus.PUBLISHED);
    expect(await historyFor(ride.id)).toHaveLength(1);
    expect((await historyFor(ride.id))[0]?.toStatus).toBe(RideStatus.PUBLISHED);
  });

  it('two concurrent starts produce exactly one IN_PROGRESS transition', async () => {
    const creator = await createUser('race-start');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });

    const [a, b] = await Promise.allSettled([
      startRide({ rideId: ride.id, actorId: creator.id }),
      startRide({ rideId: ride.id, actorId: creator.id }),
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
    expect(persisted.status).toBe(RideStatus.IN_PROGRESS);
    expect(await historyFor(ride.id)).toHaveLength(1);
    expect((await historyFor(ride.id))[0]?.toStatus).toBe(
      RideStatus.IN_PROGRESS,
    );
  });

  it('two concurrent completions produce exactly one COMPLETED transition', async () => {
    const creator = await createUser('race-complete');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.IN_PROGRESS,
    });

    const [a, b] = await Promise.allSettled([
      completeRide({ rideId: ride.id, actorId: creator.id }),
      completeRide({ rideId: ride.id, actorId: creator.id }),
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
    expect(persisted.status).toBe(RideStatus.COMPLETED);
    expect(await historyFor(ride.id)).toHaveLength(1);
    expect((await historyFor(ride.id))[0]?.toStatus).toBe(RideStatus.COMPLETED);
  });
});

describe('creator read path — real database integration', () => {
  it('lists only the creator’s rides, ordered by departureDateTime ASC, with live availableSeats', async () => {
    const creator = await createUser('read-list');
    const passenger = await createUser('read-passenger');
    const otherCreator = await createUser('read-other');

    const late = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
      departureDateTime: new Date('2026-08-22T10:00:00.000Z'),
    });
    const early = await createRideFixture(creator.id, {
      status: RideStatus.DRAFT,
      departureDateTime: new Date('2026-08-20T10:00:00.000Z'),
    });
    const confirmed = await createRideFixture(creator.id, {
      status: RideStatus.CONFIRMED,
      departureDateTime: new Date('2026-08-21T10:00:00.000Z'),
      totalSeats: 4,
    });
    await addConfirmedParticipant(confirmed.ride.id, passenger.id, 1);
    // A ride owned by someone else must never appear.
    const foreign = await createRideFixture(otherCreator.id, {
      status: RideStatus.PUBLISHED,
      departureDateTime: new Date('2026-08-19T10:00:00.000Z'),
    });

    const rides = await listCreatorRides({ actorId: creator.id });

    const ids = rides.map((r) => r.id);
    expect(ids).toEqual([early.ride.id, confirmed.ride.id, late.ride.id]);
    expect(ids).not.toContain(foreign.ride.id);

    // Order: earliest departure first.
    const byId = new Map(rides.map((r) => [r.id, r]));
    expect(byId.get(early.ride.id)?.status).toBe(RideStatus.DRAFT);
    expect(byId.get(confirmed.ride.id)?.status).toBe(RideStatus.CONFIRMED);
    expect(byId.get(late.ride.id)?.status).toBe(RideStatus.PUBLISHED);

    // availableSeats reflects the CONFIRMED participant (4 − 1 = 3).
    expect(byId.get(confirmed.ride.id)?.availableSeats).toBe(3);
    expect(byId.get(early.ride.id)?.availableSeats).toBe(3);
  });

  it('returns an empty list for a creator with no rides', async () => {
    const creator = await createUser('read-empty');
    expect(await listCreatorRides({ actorId: creator.id })).toEqual([]);
  });

  it('returns a creator-owned ride by id with live availableSeats', async () => {
    const creator = await createUser('read-detail');
    const passenger = await createUser('read-detail-passenger');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.IN_PROGRESS,
      totalSeats: 2,
    });
    await addConfirmedParticipant(ride.id, passenger.id, 1);

    const detail = await getCreatorRide({
      rideId: ride.id,
      actorId: creator.id,
    });

    expect(detail.id).toBe(ride.id);
    expect(detail.status).toBe(RideStatus.IN_PROGRESS);
    expect(detail.availableSeats).toBe(1);
    expect(detail.creator.id).toBe(creator.id);
    expect(detail.pricePerKm).toBe(4);
  });

  it('blocks a non-creator from reading another user’s ride (403, no existence leak)', async () => {
    const creator = await createUser('read-owner');
    const stranger = await createUser('read-stranger');
    const { ride } = await createRideFixture(creator.id, {
      status: RideStatus.PUBLISHED,
    });

    await expect(
      getCreatorRide({ rideId: ride.id, actorId: stranger.id }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('returns 404 for a missing ride', async () => {
    const creator = await createUser('read-missing');
    await expect(
      getCreatorRide({ rideId: unique('missing'), actorId: creator.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
