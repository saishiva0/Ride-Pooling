/**
 * Unit tests for the Phase 3.17 creator read path — `listCreatorRides` and
 * `getCreatorRide`.
 *
 * No PostgreSQL required: the read persistence port is faked. Covers input
 * validation, deterministic mapping (CreatedRide shape + availableSeats),
 * ordering passthrough (departureDateTime ASC — the repository's job, the
 * service keeps it), missing ride → NotFound, and creator authorization on
 * the detail lookup (existence is never leaked).
 */
import { describe, expect, it, vi } from 'vitest';
import { PricingType, RideStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import type { PersistedCreatorRide } from '../infrastructure/ride.repository.js';
import { listCreatorRides } from './list-creator-rides.js';
import { getCreatorRide } from './get-ride-detail.js';
import type {
  CreatorRideReadPersistence,
  RideCreatorReadDependencies,
} from './creator-ride-read.js';

const creatorId = 'creator-1';
const rideId = 'ride-1';

/** A minimal persisted creator ride record (Decimal fields via Prisma). */
function persistedRide(
  overrides: Partial<PersistedCreatorRide['ride']> = {},
  availableSeats = 3,
): PersistedCreatorRide {
  return {
    ride: {
      id: rideId,
      creatorId,
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
      status: RideStatus.PUBLISHED,
      createdAt: new Date('2026-08-18T10:00:00.000Z'),
      updatedAt: new Date('2026-08-18T10:00:00.000Z'),
      creator: {
        id: creatorId,
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

function fakePersistence(
  overrides: Partial<CreatorRideReadPersistence> = {},
): CreatorRideReadPersistence {
  return {
    listCreatorRides: vi.fn(),
    findCreatorRide: vi.fn(),
    ...overrides,
  };
}

function run<T, I extends { rideId?: string; actorId: string }>(
  useCase: (
    input: I,
    deps: { runTransaction: RideCreatorReadDependencies['runTransaction'] },
  ) => Promise<T>,
  persistence: CreatorRideReadPersistence,
  input: I,
): Promise<T> {
  return useCase(input, {
    runTransaction: async (work) => work(persistence),
  });
}

describe('listCreatorRides', () => {
  it('maps each record to the CreatorRide shape with availableSeats', async () => {
    const persistence = fakePersistence({
      listCreatorRides: vi.fn().mockResolvedValue([
        persistedRide({ status: RideStatus.DRAFT }, 4),
        persistedRide(
          {
            id: 'ride-2',
            departureDateTime: new Date('2026-08-21T10:00:00.000Z'),
          },
          1,
        ),
      ]),
    });

    const rides = await run(listCreatorRides, persistence, {
      actorId: creatorId,
    });

    expect(rides).toHaveLength(2);
    expect(rides?.[0]).toMatchObject({
      id: rideId,
      creator: { id: creatorId, name: 'Creator One' },
      status: RideStatus.DRAFT,
      totalSeats: 4,
      availableSeats: 4,
      pricePerKm: 4,
      pickupLocation: { latitude: 12.9716, longitude: 77.6412 },
    });
    expect(rides?.[1].availableSeats).toBe(1);
    // No raw Prisma types leak into the application shape.
    expect((rides?.[0] as { pricePerKm: unknown }).pricePerKm).toBe(4);
    expect(persistence.listCreatorRides).toHaveBeenCalledWith(creatorId);
  });

  it('returns an empty list when the creator has no rides', async () => {
    const persistence = fakePersistence({
      listCreatorRides: vi.fn().mockResolvedValue([]),
    });

    const rides = await run(listCreatorRides, persistence, {
      actorId: creatorId,
    });
    expect(rides).toEqual([]);
  });

  it('rejects malformed input before touching the transaction', async () => {
    const runTransaction = vi.fn();
    const deps = {
      runTransaction:
        runTransaction as unknown as RideCreatorReadDependencies['runTransaction'],
    };
    await expect(
      listCreatorRides({ actorId: '' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('getCreatorRide', () => {
  it('returns the actor-owned ride with live availableSeats', async () => {
    const persistence = fakePersistence({
      findCreatorRide: vi.fn().mockResolvedValue(persistedRide({}, 2)),
    });

    const ride = await run(getCreatorRide, persistence, {
      rideId,
      actorId: creatorId,
    });

    expect(ride).toMatchObject({
      id: rideId,
      status: RideStatus.PUBLISHED,
      availableSeats: 2,
    });
    expect(persistence.findCreatorRide).toHaveBeenCalledWith(rideId);
  });

  it('throws NotFound for a missing ride without leaking existence', async () => {
    const persistence = fakePersistence({
      findCreatorRide: vi.fn().mockResolvedValue(null),
    });

    const promise = run(getCreatorRide, persistence, {
      rideId,
      actorId: creatorId,
    });
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    await expect(promise).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  });

  it('throws Authorization when the ride belongs to someone else (no leak)', async () => {
    const persistence = fakePersistence({
      findCreatorRide: vi.fn().mockResolvedValue(
        persistedRide({
          creatorId: 'someone-else',
          creator: {
            id: 'someone-else',
            name: 'Someone Else',
            createdAt: new Date('2026-08-18T10:00:00.000Z'),
            updatedAt: new Date('2026-08-18T10:00:00.000Z'),
            phone: '+919999999999',
            email: null,
          },
        }),
      ),
    });

    const promise = run(getCreatorRide, persistence, {
      rideId,
      actorId: creatorId,
    });
    await expect(promise).rejects.toBeInstanceOf(AuthorizationError);
    await expect(promise).rejects.toMatchObject({
      code: 'AUTHORIZATION_ERROR',
      statusCode: 403,
    });
  });

  it('rejects malformed input before touching the transaction', async () => {
    const runTransaction = vi.fn();
    const deps = {
      runTransaction:
        runTransaction as unknown as RideCreatorReadDependencies['runTransaction'],
    };
    await expect(
      getCreatorRide({ rideId: '', actorId: creatorId }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      getCreatorRide({ rideId, actorId: '   ' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});
