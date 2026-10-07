/**
 * Unit tests for the V1 rider read path — `listMyRideRequests` and
 * `listJoinedRides`.
 *
 * No PostgreSQL required: the read persistence port is faked. Covers input
 * validation, deterministic mapping to the shared ride/request shapes,
 * ordering passthrough (the repository's job), and empty results.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  Prisma,
  PricingType,
  RideRequestStatus,
  RideStatus,
} from '@prisma/client';
import { ValidationError } from '../../../lib/errors.js';
import type {
  PersistedCreatorRide,
  PersistedParticipantRideRequest,
} from '../infrastructure/ride.repository.js';
import type {
  ParticipantRideReadDependencies,
  ParticipantRideReadPersistence,
} from './participant-ride-read.js';
import { listJoinedRides } from './list-joined-rides.js';
import { listMyRideRequests } from './list-my-ride-requests.js';

const userId = 'user-1';
const rideId = 'ride-1';

function persistedRide(
  overrides: Partial<PersistedCreatorRide['ride']> = {},
  availableSeats = 3,
): PersistedCreatorRide {
  return {
    ride: {
      id: rideId,
      creatorId: 'creator-1',
      pickupLocationId: 'pickup-1',
      destinationLocationId: 'dest-1',
      departureDateTime: new Date('2026-08-20T10:00:00.000Z'),
      totalSeats: 4,
      vehicleType: 'car',
      discoveryRadiusKm: 8,
      pricingType: PricingType.STANDARD,
      pricePerKm: new Prisma.Decimal(4),
      estimatedDistanceKm: new Prisma.Decimal(12.5),
      estimatedContribution: new Prisma.Decimal(50),
      status: RideStatus.CONFIRMED,
      createdAt: new Date('2026-08-18T10:00:00.000Z'),
      updatedAt: new Date('2026-08-18T10:00:00.000Z'),
      creator: {
        id: 'creator-1',
        name: 'Creator One',
        createdAt: new Date('2026-08-18T10:00:00.000Z'),
        updatedAt: new Date('2026-08-18T10:00:00.000Z'),
        phone: '+911234567890',
        email: null,
      },
      pickupLocation: {
        id: 'pickup-1',
        latitude: new Prisma.Decimal(12.9716),
        longitude: new Prisma.Decimal(77.6412),
        label: 'Indiranagar',
        createdAt: new Date('2026-08-18T10:00:00.000Z'),
        updatedAt: new Date('2026-08-18T10:00:00.000Z'),
      },
      destinationLocation: {
        id: 'dest-1',
        latitude: new Prisma.Decimal(12.9698),
        longitude: new Prisma.Decimal(77.75),
        label: 'Whitefield',
        createdAt: new Date('2026-08-18T10:00:00.000Z'),
        updatedAt: new Date('2026-08-18T10:00:00.000Z'),
      },
      ...overrides,
    },
    availableSeats,
  };
}

function persistedRequest(
  overrides: Partial<PersistedParticipantRideRequest['request']> = {},
  ride: PersistedCreatorRide = persistedRide(),
): PersistedParticipantRideRequest {
  return {
    request: {
      id: 'request-1',
      rideId: ride.ride.id,
      userId,
      requestedSeats: 2,
      status: RideRequestStatus.ACCEPTED,
      createdAt: new Date('2026-08-18T09:00:00.000Z'),
      updatedAt: new Date('2026-08-18T09:30:00.000Z'),
      resolvedAt: new Date('2026-08-18T09:30:00.000Z'),
      ...overrides,
    },
    ride: ride.ride,
    availableSeats: ride.availableSeats,
  };
}

function fakePersistence(
  overrides: Partial<ParticipantRideReadPersistence> = {},
): ParticipantRideReadPersistence {
  return {
    listParticipantRequests: vi.fn(),
    listConfirmedRides: vi.fn(),
    ...overrides,
  };
}

function run<T, I extends { userId: string }>(
  useCase: (input: I, deps: ParticipantRideReadDependencies) => Promise<T>,
  persistence: ParticipantRideReadPersistence,
  input: I,
): Promise<T> {
  const deps: ParticipantRideReadDependencies = {
    runTransaction: (work) => work(persistence),
  };
  return useCase(input, deps);
}

describe('listMyRideRequests', () => {
  it('maps each request to the participant shape with its ride and seats', async () => {
    const persistence = fakePersistence({
      listParticipantRequests: vi
        .fn()
        .mockResolvedValue([persistedRequest({}, persistedRide({}, 2))]),
    });

    const requests = await run(listMyRideRequests, persistence, { userId });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      request: {
        id: 'request-1',
        requestedSeats: 2,
        status: RideRequestStatus.ACCEPTED,
        resolvedAt: new Date('2026-08-18T09:30:00.000Z'),
      },
      ride: {
        id: rideId,
        creator: { id: 'creator-1', name: 'Creator One' },
        status: RideStatus.CONFIRMED,
        availableSeats: 2,
      },
    });
    expect(persistence.listParticipantRequests).toHaveBeenCalledWith(userId);
  });

  it('returns an empty list when the participant has made no requests', async () => {
    const persistence = fakePersistence({
      listParticipantRequests: vi.fn().mockResolvedValue([]),
    });

    expect(await run(listMyRideRequests, persistence, { userId })).toEqual([]);
  });

  it('rejects malformed input before touching the transaction', async () => {
    const runTransaction = vi.fn();
    const deps: Partial<ParticipantRideReadDependencies> = {
      runTransaction:
        runTransaction as unknown as ParticipantRideReadDependencies['runTransaction'],
    };
    await expect(
      listMyRideRequests({ userId: '   ' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('listJoinedRides', () => {
  it('maps confirmed participation rides to the shared ride shape', async () => {
    const persistence = fakePersistence({
      listConfirmedRides: vi
        .fn()
        .mockResolvedValue([
          persistedRide({ status: RideStatus.IN_PROGRESS }, 1),
        ]),
    });

    const rides = await run(listJoinedRides, persistence, { userId });

    expect(rides).toHaveLength(1);
    expect(rides[0]).toMatchObject({
      id: rideId,
      status: RideStatus.IN_PROGRESS,
      availableSeats: 1,
      creator: { id: 'creator-1', name: 'Creator One' },
    });
    expect(persistence.listConfirmedRides).toHaveBeenCalledWith(userId);
  });

  it('returns an empty list when the participant has joined no rides', async () => {
    const persistence = fakePersistence({
      listConfirmedRides: vi.fn().mockResolvedValue([]),
    });

    expect(await run(listJoinedRides, persistence, { userId })).toEqual([]);
  });

  it('rejects malformed input before touching the transaction', async () => {
    const runTransaction = vi.fn();
    const deps: Partial<ParticipantRideReadDependencies> = {
      runTransaction:
        runTransaction as unknown as ParticipantRideReadDependencies['runTransaction'],
    };
    await expect(listJoinedRides({ userId: '' }, deps)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(runTransaction).not.toHaveBeenCalled();
  });
});
