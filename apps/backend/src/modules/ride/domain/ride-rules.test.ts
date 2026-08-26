import { describe, expect, it } from 'vitest';
import { PricingType } from '@prisma/client';
import {
  assertValidRideFields,
  isSameCoordinates,
  isValidLatitude,
  isValidLongitude,
  isValidPricePerKm,
  isValidSeatCount,
  RIDE_PRICING_CONFIG,
} from './ride-rules.js';
import { RideValidationError } from './ride.errors.js';
import type { RideFieldsInput } from './ride.types.js';

describe('RIDE_PRICING_CONFIG', () => {
  it('matches the approved Phase 0 pricing model exactly', () => {
    expect(RIDE_PRICING_CONFIG.standardPricePerKm).toBe(4);
    expect(RIDE_PRICING_CONFIG.customPricePerKm).toEqual({ min: 2, max: 6 });
    expect(RIDE_PRICING_CONFIG.currency).toBe('INR');
  });
});

describe('isValidSeatCount', () => {
  it('accepts positive integers', () => {
    expect(isValidSeatCount(1)).toBe(true);
    expect(isValidSeatCount(3)).toBe(true);
    expect(isValidSeatCount(8)).toBe(true);
  });

  it('rejects zero', () => {
    expect(isValidSeatCount(0)).toBe(false);
  });

  it('rejects negative values', () => {
    expect(isValidSeatCount(-1)).toBe(false);
    expect(isValidSeatCount(-5)).toBe(false);
  });

  it('rejects non-integer values', () => {
    expect(isValidSeatCount(1.5)).toBe(false);
  });

  it('rejects non-finite values', () => {
    expect(isValidSeatCount(Number.NaN)).toBe(false);
    expect(isValidSeatCount(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('isValidLatitude', () => {
  it('accepts the valid minimum (-90)', () => {
    expect(isValidLatitude(-90)).toBe(true);
  });

  it('accepts the valid maximum (90)', () => {
    expect(isValidLatitude(90)).toBe(true);
  });

  it('accepts a typical mid-range value', () => {
    expect(isValidLatitude(12.9716)).toBe(true);
  });

  it('rejects values below the minimum', () => {
    expect(isValidLatitude(-90.0001)).toBe(false);
    expect(isValidLatitude(-200)).toBe(false);
  });

  it('rejects values above the maximum', () => {
    expect(isValidLatitude(90.0001)).toBe(false);
    expect(isValidLatitude(200)).toBe(false);
  });

  it('rejects non-finite values', () => {
    expect(isValidLatitude(Number.NaN)).toBe(false);
  });
});

describe('isValidLongitude', () => {
  it('accepts the valid minimum (-180)', () => {
    expect(isValidLongitude(-180)).toBe(true);
  });

  it('accepts the valid maximum (180)', () => {
    expect(isValidLongitude(180)).toBe(true);
  });

  it('accepts a typical mid-range value', () => {
    expect(isValidLongitude(77.5946)).toBe(true);
  });

  it('rejects values below the minimum', () => {
    expect(isValidLongitude(-180.0001)).toBe(false);
    expect(isValidLongitude(-200)).toBe(false);
  });

  it('rejects values above the maximum', () => {
    expect(isValidLongitude(180.0001)).toBe(false);
    expect(isValidLongitude(200)).toBe(false);
  });

  it('rejects non-finite values', () => {
    expect(isValidLongitude(Number.NaN)).toBe(false);
  });
});

describe('isValidPricePerKm', () => {
  it('accepts STANDARD at exactly ₹4/km', () => {
    expect(isValidPricePerKm(PricingType.STANDARD, 4)).toBe(true);
  });

  it('rejects STANDARD at any value other than ₹4/km', () => {
    expect(isValidPricePerKm(PricingType.STANDARD, 3)).toBe(false);
    expect(isValidPricePerKm(PricingType.STANDARD, 5)).toBe(false);
  });

  it.each([2, 3, 4, 5, 6])('accepts CUSTOM at ₹%i/km', (price) => {
    expect(isValidPricePerKm(PricingType.CUSTOM, price)).toBe(true);
  });

  it('rejects CUSTOM below ₹2/km', () => {
    expect(isValidPricePerKm(PricingType.CUSTOM, 1.99)).toBe(false);
    expect(isValidPricePerKm(PricingType.CUSTOM, 0)).toBe(false);
    expect(isValidPricePerKm(PricingType.CUSTOM, -1)).toBe(false);
  });

  it('rejects CUSTOM above ₹6/km', () => {
    expect(isValidPricePerKm(PricingType.CUSTOM, 6.01)).toBe(false);
    expect(isValidPricePerKm(PricingType.CUSTOM, 10)).toBe(false);
  });

  it('rejects non-finite values', () => {
    expect(isValidPricePerKm(PricingType.CUSTOM, Number.NaN)).toBe(false);
  });
});

describe('isSameCoordinates', () => {
  it('returns false for different coordinates', () => {
    expect(
      isSameCoordinates(
        { latitude: 12.9716, longitude: 77.5946 },
        { latitude: 12.2958, longitude: 76.6394 },
      ),
    ).toBe(false);
  });

  it('returns true for identical coordinates', () => {
    expect(
      isSameCoordinates(
        { latitude: 12.9716, longitude: 77.5946 },
        { latitude: 12.9716, longitude: 77.5946 },
      ),
    ).toBe(true);
  });
});

describe('assertValidRideFields', () => {
  const validInput: RideFieldsInput = {
    totalSeats: 3,
    pricingType: PricingType.STANDARD,
    pricePerKm: 4,
    pickup: { latitude: 12.9716, longitude: 77.5946 },
    destination: { latitude: 12.2958, longitude: 76.6394 },
  };

  it('does not throw for fully valid input', () => {
    expect(() => assertValidRideFields(validInput)).not.toThrow();
  });

  it('throws RideValidationError with reason LATITUDE_INVALID for an out-of-range pickup latitude', () => {
    const input: RideFieldsInput = {
      ...validInput,
      pickup: { ...validInput.pickup, latitude: 200 },
    };
    expect(() => assertValidRideFields(input)).toThrow(RideValidationError);
    try {
      assertValidRideFields(input);
    } catch (err) {
      const validationErr = err as RideValidationError;
      expect(validationErr.reason).toBe('LATITUDE_INVALID');
      expect(validationErr.field).toBe('pickup.latitude');
      expect(validationErr.code).toBe('VALIDATION_ERROR');
      expect(validationErr.statusCode).toBe(400);
    }
  });

  it('throws RideValidationError with reason LONGITUDE_INVALID for an out-of-range destination longitude', () => {
    const input: RideFieldsInput = {
      ...validInput,
      destination: { ...validInput.destination, longitude: -200 },
    };
    try {
      assertValidRideFields(input);
      throw new Error('expected assertValidRideFields to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RideValidationError);
      expect((err as RideValidationError).reason).toBe('LONGITUDE_INVALID');
      expect((err as RideValidationError).field).toBe('destination.longitude');
    }
  });

  it('throws RideValidationError with reason ORIGIN_DESTINATION_IDENTICAL when pickup equals destination', () => {
    const input: RideFieldsInput = {
      ...validInput,
      destination: { ...validInput.pickup },
    };
    try {
      assertValidRideFields(input);
      throw new Error('expected assertValidRideFields to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RideValidationError);
      expect((err as RideValidationError).reason).toBe(
        'ORIGIN_DESTINATION_IDENTICAL',
      );
    }
  });

  it('throws RideValidationError with reason SEATS_INVALID for zero seats', () => {
    const input: RideFieldsInput = { ...validInput, totalSeats: 0 };
    try {
      assertValidRideFields(input);
      throw new Error('expected assertValidRideFields to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RideValidationError);
      expect((err as RideValidationError).reason).toBe('SEATS_INVALID');
      expect((err as RideValidationError).field).toBe('totalSeats');
    }
  });

  it('throws RideValidationError with reason PRICE_INVALID for an out-of-range custom price', () => {
    const input: RideFieldsInput = {
      ...validInput,
      pricingType: PricingType.CUSTOM,
      pricePerKm: 9,
    };
    try {
      assertValidRideFields(input);
      throw new Error('expected assertValidRideFields to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RideValidationError);
      expect((err as RideValidationError).reason).toBe('PRICE_INVALID');
      expect((err as RideValidationError).field).toBe('pricePerKm');
    }
  });
});
