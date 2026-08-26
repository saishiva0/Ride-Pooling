/**
 * Ride domain validation rules (Phase 3.1).
 *
 * Pure predicate/assertion functions only — no I/O, no persistence, no
 * contribution calculation (that belongs to a later pricing/business
 * service slice per `docs/domain/pricing-model.md` §4). These rules protect
 * application-level business invariants; database CHECK constraints
 * (`docs/development/phase-2-notes.md`) remain the final persistence
 * safeguard and are intentionally not duplicated here beyond what the
 * domain also needs to validate before persistence is attempted.
 */
import { PricingType } from '@prisma/client';
import { RideValidationError } from './ride.errors.js';
import {
  isValidLatitude,
  isValidLongitude,
} from '../../location/domain/coordinate.js';
import type { RideCoordinates, RideFieldsInput } from './ride.types.js';

// Coordinate predicates are centralized in the Location & Maps module
// (`modules/location/domain/coordinate.ts`, Phase 3.12) and re-exported here
// so this module's public API is unchanged — see
// `docs/development/phase-3-12-notes.md` §6.

/**
 * Pricing configuration — values only, per `docs/domain/pricing-model.md`
 * §7 ("Rates and ranges are configuration, not code"). Do not hardcode
 * these numbers anywhere else; import this constant instead.
 */
export const RIDE_PRICING_CONFIG = {
  standardPricePerKm: 4,
  customPricePerKm: { min: 2, max: 6 },
  currency: 'INR',
} as const;

const MIN_SEATS = 1;

/** Total seats must be a positive integer (`docs/domain/ride-engine.md` §4.2). */
export function isValidSeatCount(totalSeats: number): boolean {
  return Number.isInteger(totalSeats) && totalSeats >= MIN_SEATS;
}

// isValidLatitude / isValidLongitude are imported above from the Location &
// Maps module and re-exported below to preserve this module's public surface.
export { isValidLatitude, isValidLongitude };

/**
 * Price per km must match the approved pricing model
 * (`docs/domain/pricing-model.md` §2, §6):
 * - STANDARD: must equal the configured recommended rate (₹4/km).
 * - CUSTOM: must fall within the configured range (₹2–₹6/km inclusive).
 */
export function isValidPricePerKm(
  pricingType: PricingType,
  pricePerKm: number,
): boolean {
  if (!Number.isFinite(pricePerKm)) {
    return false;
  }
  if (pricingType === PricingType.STANDARD) {
    return pricePerKm === RIDE_PRICING_CONFIG.standardPricePerKm;
  }
  return (
    pricePerKm >= RIDE_PRICING_CONFIG.customPricePerKm.min &&
    pricePerKm <= RIDE_PRICING_CONFIG.customPricePerKm.max
  );
}

/** Whether two coordinate pairs represent the identical point. */
export function isSameCoordinates(
  a: RideCoordinates,
  b: RideCoordinates,
): boolean {
  return a.latitude === b.latitude && a.longitude === b.longitude;
}

/**
 * Validates the Ride domain fields Phase 3.1 owns and throws
 * `RideValidationError` on the first failing rule. Pure — no I/O.
 */
export function assertValidRideFields(input: RideFieldsInput): void {
  if (!isValidLatitude(input.pickup.latitude)) {
    throw new RideValidationError(
      'Pickup latitude is out of bounds',
      'LATITUDE_INVALID',
      {
        field: 'pickup.latitude',
        details: { latitude: input.pickup.latitude },
      },
    );
  }
  if (!isValidLongitude(input.pickup.longitude)) {
    throw new RideValidationError(
      'Pickup longitude is out of bounds',
      'LONGITUDE_INVALID',
      {
        field: 'pickup.longitude',
        details: { longitude: input.pickup.longitude },
      },
    );
  }
  if (!isValidLatitude(input.destination.latitude)) {
    throw new RideValidationError(
      'Destination latitude is out of bounds',
      'LATITUDE_INVALID',
      {
        field: 'destination.latitude',
        details: { latitude: input.destination.latitude },
      },
    );
  }
  if (!isValidLongitude(input.destination.longitude)) {
    throw new RideValidationError(
      'Destination longitude is out of bounds',
      'LONGITUDE_INVALID',
      {
        field: 'destination.longitude',
        details: { longitude: input.destination.longitude },
      },
    );
  }
  if (isSameCoordinates(input.pickup, input.destination)) {
    throw new RideValidationError(
      'Pickup and destination cannot be identical',
      'ORIGIN_DESTINATION_IDENTICAL',
      { field: 'destination' },
    );
  }
  if (!isValidSeatCount(input.totalSeats)) {
    throw new RideValidationError(
      'Total seats must be a positive integer',
      'SEATS_INVALID',
      { field: 'totalSeats', details: { totalSeats: input.totalSeats } },
    );
  }
  if (!isValidPricePerKm(input.pricingType, input.pricePerKm)) {
    throw new RideValidationError(
      'Price per km is not valid for the selected pricing type',
      'PRICE_INVALID',
      {
        field: 'pricePerKm',
        details: {
          pricingType: input.pricingType,
          pricePerKm: input.pricePerKm,
        },
      },
    );
  }
}
