/**
 * Ride domain types (Phase 3.1).
 *
 * `RideStatus` and `PricingType` are re-exported from the Prisma-generated
 * client rather than redefined here, so the domain layer and the
 * persistence layer (Phase 2) always agree on the same set of values —
 * see `docs/domain/ride-lifecycle.md` §1 and `docs/domain/pricing-model.md`
 * §2.
 */
import type { PricingType, RideStatus } from '@prisma/client';

export type { PricingType, RideStatus };

/** A geographic coordinate pair used for pickup/destination validation. */
export interface RideCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * The subset of Ride fields that Phase 3.1 domain validation owns
 * (`docs/domain/ride-engine.md` §4.2, §5). This is not a persistence or API
 * DTO — ride creation input shapes are defined by a later phase.
 */
export interface RideFieldsInput {
  totalSeats: number;
  pricingType: PricingType;
  pricePerKm: number;
  pickup: RideCoordinates;
  destination: RideCoordinates;
}
