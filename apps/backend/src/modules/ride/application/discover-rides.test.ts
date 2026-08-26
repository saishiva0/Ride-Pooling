/**
 * Unit tests for the Phase 3.3 ride discovery use case.
 *
 * No PostgreSQL required: the repository dependency is mocked. Covers input
 * validation, result mapping, the default result limit, error handling, and
 * the explicit "discovery is not matching" guarantee (results pass through
 * in repository order with no scoring/ranking transformation).
 */
import { describe, expect, it, vi } from 'vitest';
import { PricingType, RideStatus } from '@prisma/client';
import { discoverRides, DEFAULT_DISCOVERY_LIMIT } from './discover-rides.js';
import type { RideDiscoveryInput } from './discover-rides.js';
import type { DiscoveredRideRow } from '../infrastructure/ride.repository.js';
import { NotFoundError } from '../../../lib/errors.js';

const validInput: RideDiscoveryInput = {
  latitude: 12.9716,
  longitude: 77.5946,
  radiusMeters: 5000,
};

function fakeRow(
  overrides: Partial<DiscoveredRideRow> = {},
): DiscoveredRideRow {
  return {
    id: 'ride-1',
    creatorId: 'user-1',
    creatorName: 'Riya',
    departureDateTime: new Date('2026-08-20T10:00:00.000Z'),
    totalSeats: 3,
    availableSeats: 2,
    pricingType: PricingType.STANDARD,
    pricePerKm: 4,
    pickupLocationId: 'loc-pickup',
    pickupLatitude: 12.9716,
    pickupLongitude: 77.5946,
    pickupLabel: 'Pickup',
    destinationLocationId: 'loc-destination',
    destinationLatitude: 12.2958,
    destinationLongitude: 76.6394,
    destinationLabel: 'Destination',
    distanceMeters: 1234.5,
    status: RideStatus.PUBLISHED,
    ...overrides,
  };
}

describe('discoverRides — valid input', () => {
  it('passes the resolved query to the repository and returns mapped results', async () => {
    const discoverRidesQuery = vi
      .fn()
      .mockResolvedValue([fakeRow(), fakeRow({ id: 'ride-2' })]);

    const results = await discoverRides(validInput, { discoverRidesQuery });

    expect(discoverRidesQuery).toHaveBeenCalledTimes(1);
    expect(discoverRidesQuery).toHaveBeenCalledWith({
      latitude: 12.9716,
      longitude: 77.5946,
      radiusMeters: 5000,
      limit: DEFAULT_DISCOVERY_LIMIT,
    });
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: 'ride-1',
      creator: { id: 'user-1', name: 'Riya' },
      pickupLocation: {
        id: 'loc-pickup',
        latitude: 12.9716,
        longitude: 77.5946,
        label: 'Pickup',
      },
      destinationLocation: {
        id: 'loc-destination',
        latitude: 12.2958,
        longitude: 76.6394,
        label: 'Destination',
      },
      departureDateTime: new Date('2026-08-20T10:00:00.000Z'),
      totalSeats: 3,
      availableSeats: 2,
      pricingType: PricingType.STANDARD,
      pricePerKm: 4,
      distanceMeters: 1234.5,
      status: RideStatus.PUBLISHED,
    });
  });

  it('uses the caller-supplied limit instead of the default', async () => {
    const discoverRidesQuery = vi.fn().mockResolvedValue([]);

    await discoverRides({ ...validInput, limit: 7 }, { discoverRidesQuery });

    expect(discoverRidesQuery).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 7 }),
    );
  });

  it('does not implement matching logic: results pass through unchanged in repository order', async () => {
    // Discovery is candidate retrieval, not matching (Phase 3.3 §3). The
    // application layer must not reorder, score, or filter results — it maps
    // rows 1:1 and returns them in the order the database provided.
    const discoverRidesQuery = vi
      .fn()
      .mockResolvedValue([
        fakeRow({ id: 'far', distanceMeters: 9000 }),
        fakeRow({ id: 'near', distanceMeters: 50 }),
      ]);

    const results = await discoverRides(validInput, { discoverRidesQuery });

    expect(results.map((r) => r.id)).toEqual(['far', 'near']);
    expect(results.map((r) => r.distanceMeters)).toEqual([9000, 50]);
    expect(results[0]).not.toHaveProperty('matchScore');
    expect(results[0]).not.toHaveProperty('rank');
  });
});

describe('discoverRides — input validation', () => {
  it('rejects an out-of-range latitude without calling the repository', async () => {
    const discoverRidesQuery = vi.fn();

    await expect(
      discoverRides({ ...validInput, latitude: 91 }, { discoverRidesQuery }),
    ).rejects.toThrow(/latitude/);
    expect(discoverRidesQuery).not.toHaveBeenCalled();
  });

  it('rejects a NaN latitude without calling the repository', async () => {
    const discoverRidesQuery = vi.fn();

    await expect(
      discoverRides(
        { ...validInput, latitude: Number.NaN },
        { discoverRidesQuery },
      ),
    ).rejects.toThrow(/latitude/);
    expect(discoverRidesQuery).not.toHaveBeenCalled();
  });

  it('rejects an Infinity latitude without calling the repository', async () => {
    const discoverRidesQuery = vi.fn();

    await expect(
      discoverRides(
        { ...validInput, latitude: Number.POSITIVE_INFINITY },
        { discoverRidesQuery },
      ),
    ).rejects.toThrow(/latitude/);
    expect(discoverRidesQuery).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range longitude without calling the repository', async () => {
    const discoverRidesQuery = vi.fn();

    await expect(
      discoverRides({ ...validInput, longitude: -181 }, { discoverRidesQuery }),
    ).rejects.toThrow(/longitude/);
    expect(discoverRidesQuery).not.toHaveBeenCalled();
  });

  it('rejects a zero radius without calling the repository', async () => {
    const discoverRidesQuery = vi.fn();

    await expect(
      discoverRides({ ...validInput, radiusMeters: 0 }, { discoverRidesQuery }),
    ).rejects.toThrow(/radiusMeters/);
    expect(discoverRidesQuery).not.toHaveBeenCalled();
  });

  it('rejects a negative radius without calling the repository', async () => {
    const discoverRidesQuery = vi.fn();

    await expect(
      discoverRides(
        { ...validInput, radiusMeters: -10 },
        { discoverRidesQuery },
      ),
    ).rejects.toThrow(/radiusMeters/);
    expect(discoverRidesQuery).not.toHaveBeenCalled();
  });

  it('rejects a NaN radius without calling the repository', async () => {
    const discoverRidesQuery = vi.fn();

    await expect(
      discoverRides(
        { ...validInput, radiusMeters: Number.NaN },
        { discoverRidesQuery },
      ),
    ).rejects.toThrow(/radiusMeters/);
    expect(discoverRidesQuery).not.toHaveBeenCalled();
  });

  it('rejects an Infinity radius without calling the repository', async () => {
    const discoverRidesQuery = vi.fn();

    await expect(
      discoverRides(
        { ...validInput, radiusMeters: Number.POSITIVE_INFINITY },
        { discoverRidesQuery },
      ),
    ).rejects.toThrow(/radiusMeters/);
    expect(discoverRidesQuery).not.toHaveBeenCalled();
  });

  it('accepts valid coordinates and a finite positive radius', async () => {
    const discoverRidesQuery = vi.fn().mockResolvedValue([]);

    await expect(
      discoverRides(
        { latitude: -89.9, longitude: 179.9, radiusMeters: 1 },
        { discoverRidesQuery },
      ),
    ).resolves.toEqual([]);
    expect(discoverRidesQuery).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-positive or non-integer limit', async () => {
    const discoverRidesQuery = vi.fn();

    for (const limit of [0, -3, 2.5]) {
      await expect(
        discoverRides({ ...validInput, limit }, { discoverRidesQuery }),
      ).rejects.toThrow(/limit/);
    }
    expect(discoverRidesQuery).not.toHaveBeenCalled();
  });
});

describe('discoverRides — error handling', () => {
  it('propagates application errors from the repository', async () => {
    const discoverRidesQuery = vi
      .fn()
      .mockRejectedValue(new NotFoundError('Not found', { field: 'id' }));

    await expect(
      discoverRides(validInput, { discoverRidesQuery }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('wraps an unexpected repository failure without leaking it directly', async () => {
    const discoverRidesQuery = vi
      .fn()
      .mockRejectedValue(new Error('connection reset by peer'));

    const promise = discoverRides(validInput, { discoverRidesQuery });

    await expect(promise).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    });
    await expect(promise).rejects.not.toThrow('connection reset by peer');
  });
});
