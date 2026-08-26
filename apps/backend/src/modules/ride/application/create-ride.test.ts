import { describe, expect, it, vi } from 'vitest';
import { PricingType, RideStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createRide } from './create-ride.js';
import type { RideCreationInput } from './create-ride.js';
import { INITIAL_RIDE_STATUS } from '../infrastructure/ride.repository.js';
import type { PersistedRideRecord } from '../infrastructure/ride.repository.js';
import { NotFoundError } from '../../../lib/errors.js';
import { RideValidationError } from '../domain/ride.errors.js';

const validInput: RideCreationInput = {
  creatorId: 'user-1',
  pickup: { latitude: 12.9716, longitude: 77.5946, label: 'Pickup' },
  destination: { latitude: 12.2958, longitude: 76.6394, label: 'Destination' },
  departureDateTime: new Date(Date.now() + 60 * 60 * 1000),
  totalSeats: 3,
  pricingType: PricingType.STANDARD,
  pricePerKm: 4,
};

function fakePersistedRecord(
  overrides: Partial<PersistedRideRecord> = {},
): PersistedRideRecord {
  const base = {
    id: 'ride-1',
    creatorId: 'user-1',
    pickupLocationId: 'loc-pickup',
    destinationLocationId: 'loc-destination',
    departureDateTime: validInput.departureDateTime,
    totalSeats: validInput.totalSeats,
    vehicleType: null,
    discoveryRadiusKm: null,
    pricingType: PricingType.STANDARD,
    pricePerKm: new Decimal(4),
    estimatedDistanceKm: null,
    estimatedContribution: null,
    status: RideStatus.DRAFT,
    createdAt: new Date(),
    updatedAt: new Date(),
    creator: { id: 'user-1', name: 'Test Creator' },
    pickupLocation: {
      id: 'loc-pickup',
      latitude: new Decimal(validInput.pickup.latitude),
      longitude: new Decimal(validInput.pickup.longitude),
      label: validInput.pickup.label ?? null,
    },
    destinationLocation: {
      id: 'loc-destination',
      latitude: new Decimal(validInput.destination.latitude),
      longitude: new Decimal(validInput.destination.longitude),
      label: validInput.destination.label ?? null,
    },
  } as unknown as PersistedRideRecord;
  return { ...base, ...overrides };
}

describe('createRide — valid input', () => {
  it('persists via the injected dependency and returns a mapped result', async () => {
    const persistRide = vi.fn().mockResolvedValue(fakePersistedRecord());

    const result = await createRide(validInput, { persistRide });

    expect(persistRide).toHaveBeenCalledTimes(1);
    expect(persistRide).toHaveBeenCalledWith(validInput);
    expect(result.id).toBe('ride-1');
    expect(result.status).toBe(RideStatus.DRAFT);
    expect(result.pricePerKm).toBe(4);
    expect(result.pickupLocation.latitude).toBeCloseTo(12.9716);
    expect(result.destinationLocation.longitude).toBeCloseTo(76.6394);
    expect(result.creator).toEqual({ id: 'user-1', name: 'Test Creator' });
  });

  it('selects DRAFT as the correct initial ride state', () => {
    // The initial-state decision is a single exported constant
    // (`docs/domain/ride-lifecycle.md` §2.1) that both the repository and
    // this test reference — no DB access required to verify it.
    expect(INITIAL_RIDE_STATUS).toBe(RideStatus.DRAFT);
  });

  it('converts null optional fields to null, not undefined', async () => {
    const persistRide = vi.fn().mockResolvedValue(fakePersistedRecord());

    const result = await createRide(validInput, { persistRide });

    expect(result.vehicleType).toBeNull();
    expect(result.discoveryRadiusKm).toBeNull();
    expect(result.estimatedDistanceKm).toBeNull();
    expect(result.estimatedContribution).toBeNull();
  });

  it('converts provided estimatedDistanceKm/estimatedContribution to numbers', async () => {
    const persistRide = vi.fn().mockResolvedValue(
      fakePersistedRecord({
        estimatedDistanceKm: new Decimal(12.3) as never,
        estimatedContribution: new Decimal(49.2) as never,
      }),
    );

    const result = await createRide(
      { ...validInput, estimatedDistanceKm: 12.3, estimatedContribution: 49.2 },
      { persistRide },
    );

    expect(result.estimatedDistanceKm).toBe(12.3);
    expect(result.estimatedContribution).toBe(49.2);
  });
});

describe('createRide — domain validation (reused from Phase 3.1)', () => {
  it('rejects an invalid seat count without calling persistence', async () => {
    const persistRide = vi.fn();

    await expect(
      createRide({ ...validInput, totalSeats: 0 }, { persistRide }),
    ).rejects.toBeInstanceOf(RideValidationError);
    expect(persistRide).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range pickup latitude without calling persistence', async () => {
    const persistRide = vi.fn();

    await expect(
      createRide(
        { ...validInput, pickup: { ...validInput.pickup, latitude: 200 } },
        { persistRide },
      ),
    ).rejects.toBeInstanceOf(RideValidationError);
    expect(persistRide).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range destination longitude without calling persistence', async () => {
    const persistRide = vi.fn();

    await expect(
      createRide(
        {
          ...validInput,
          destination: { ...validInput.destination, longitude: -200 },
        },
        { persistRide },
      ),
    ).rejects.toBeInstanceOf(RideValidationError);
    expect(persistRide).not.toHaveBeenCalled();
  });

  it('rejects identical pickup and destination coordinates', async () => {
    const persistRide = vi.fn();

    await expect(
      createRide(
        { ...validInput, destination: { ...validInput.pickup } },
        { persistRide },
      ),
    ).rejects.toBeInstanceOf(RideValidationError);
    expect(persistRide).not.toHaveBeenCalled();
  });

  it('rejects an invalid STANDARD price (not exactly ₹4/km)', async () => {
    const persistRide = vi.fn();

    await expect(
      createRide(
        { ...validInput, pricingType: PricingType.STANDARD, pricePerKm: 5 },
        { persistRide },
      ),
    ).rejects.toBeInstanceOf(RideValidationError);
    expect(persistRide).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range CUSTOM price (above ₹6/km)', async () => {
    const persistRide = vi.fn();

    await expect(
      createRide(
        { ...validInput, pricingType: PricingType.CUSTOM, pricePerKm: 9 },
        { persistRide },
      ),
    ).rejects.toBeInstanceOf(RideValidationError);
    expect(persistRide).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range CUSTOM price (below ₹2/km)', async () => {
    const persistRide = vi.fn();

    await expect(
      createRide(
        { ...validInput, pricingType: PricingType.CUSTOM, pricePerKm: 1 },
        { persistRide },
      ),
    ).rejects.toBeInstanceOf(RideValidationError);
    expect(persistRide).not.toHaveBeenCalled();
  });

  it.each([2, 3, 4, 5, 6])(
    'accepts a valid CUSTOM price of ₹%i/km',
    async (price) => {
      const persistRide = vi.fn().mockResolvedValue(
        fakePersistedRecord({
          pricingType: PricingType.CUSTOM,
          pricePerKm: new Decimal(price),
        }),
      );

      const result = await createRide(
        { ...validInput, pricingType: PricingType.CUSTOM, pricePerKm: price },
        { persistRide },
      );

      expect(result.pricePerKm).toBe(price);
      expect(persistRide).toHaveBeenCalledTimes(1);
    },
  );
});

describe('createRide — application-level input shape checks', () => {
  it('rejects a missing/empty creatorId without calling persistence', async () => {
    const persistRide = vi.fn();

    await expect(
      createRide({ ...validInput, creatorId: '' }, { persistRide }),
    ).rejects.toThrow(/creatorId/);
    expect(persistRide).not.toHaveBeenCalled();
  });

  it('rejects an invalid departureDateTime without calling persistence', async () => {
    const persistRide = vi.fn();

    await expect(
      createRide(
        { ...validInput, departureDateTime: new Date(Number.NaN) },
        { persistRide },
      ),
    ).rejects.toThrow(/departureDateTime/);
    expect(persistRide).not.toHaveBeenCalled();
  });

  it('rejects a non-positive discoveryRadiusKm without calling persistence', async () => {
    const persistRide = vi.fn();

    await expect(
      createRide({ ...validInput, discoveryRadiusKm: 0 }, { persistRide }),
    ).rejects.toThrow(/discoveryRadiusKm/);
    expect(persistRide).not.toHaveBeenCalled();
  });

  it('rejects a negative estimatedDistanceKm without calling persistence', async () => {
    const persistRide = vi.fn();

    await expect(
      createRide({ ...validInput, estimatedDistanceKm: -1 }, { persistRide }),
    ).rejects.toThrow(/estimatedDistanceKm/);
    expect(persistRide).not.toHaveBeenCalled();
  });

  it('rejects a negative estimatedContribution without calling persistence', async () => {
    const persistRide = vi.fn();

    await expect(
      createRide({ ...validInput, estimatedContribution: -1 }, { persistRide }),
    ).rejects.toThrow(/estimatedContribution/);
    expect(persistRide).not.toHaveBeenCalled();
  });
});

describe('createRide — creator/persistence failure handling', () => {
  it('propagates NotFoundError from persistence when the creator does not exist', async () => {
    const persistRide = vi
      .fn()
      .mockRejectedValue(
        new NotFoundError('Ride creator not found', { field: 'creatorId' }),
      );

    await expect(
      createRide(validInput, { persistRide }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('wraps an unexpected persistence failure without leaking it directly', async () => {
    const persistRide = vi
      .fn()
      .mockRejectedValue(new Error('connection reset by peer'));

    const promise = createRide(validInput, { persistRide });

    await expect(promise).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    });
    await expect(promise).rejects.not.toThrow('connection reset by peer');
  });
});
