/**
 * Ride creation use case (Phase 3.2).
 *
 * Orchestrates the first complete Ride Engine business flow:
 *
 *   input → validation → creator lookup → transactional persistence →
 *   Ride + initial RideStatusHistory → created Ride
 *
 * Business rules live in the domain layer (`../domain/ride-rules.ts`) and
 * are reused here, not duplicated. Persistence lives in the infrastructure
 * layer (`../infrastructure/ride.repository.ts`). This module only
 * orchestrates the two. It has no knowledge of HTTP, authentication, or any
 * other Ride Engine capability (discovery, matching, requests, etc.).
 */
import { PricingType, RideStatus } from '@prisma/client';
import {
  AppError,
  InternalError,
  ValidationError,
} from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { assertValidRideFields } from '../domain/ride-rules.js';
import {
  persistNewRide,
  type PersistedRideRecord,
  type RideCreationInput,
} from '../infrastructure/ride.repository.js';

export type {
  RideCreationInput,
  RideCreationLocationInput,
} from '../infrastructure/ride.repository.js';

/** A persisted Location as returned to application-layer callers. */
export interface CreatedRideLocation {
  id: string;
  latitude: number;
  longitude: number;
  label: string | null;
}

/**
 * Maps a persisted ride record to the application-layer `CreatedRide` shape
 * (Prisma `Decimal` → plain numbers). Exported for reuse by the Phase 3.17
 * creator read path (`list-creator-rides.ts` / `get-ride-detail.ts`), which
 * extends it with live seat availability — never duplicated.
 */
export function toCreatedRide(record: PersistedRideRecord): CreatedRide {
  return {
    id: record.id,
    creator: { id: record.creator.id, name: record.creator.name },
    pickupLocation: {
      id: record.pickupLocation.id,
      latitude: record.pickupLocation.latitude.toNumber(),
      longitude: record.pickupLocation.longitude.toNumber(),
      label: record.pickupLocation.label,
    },
    destinationLocation: {
      id: record.destinationLocation.id,
      latitude: record.destinationLocation.latitude.toNumber(),
      longitude: record.destinationLocation.longitude.toNumber(),
      label: record.destinationLocation.label,
    },
    departureDateTime: record.departureDateTime,
    totalSeats: record.totalSeats,
    vehicleType: record.vehicleType,
    discoveryRadiusKm: record.discoveryRadiusKm,
    pricingType: record.pricingType,
    pricePerKm: record.pricePerKm.toNumber(),
    estimatedDistanceKm: record.estimatedDistanceKm?.toNumber() ?? null,
    estimatedContribution: record.estimatedContribution?.toNumber() ?? null,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * The created Ride, shaped for application-layer consumers. Prisma
 * `Decimal` fields are converted to plain numbers; no raw Prisma types are
 * exposed.
 */
export interface CreatedRide {
  id: string;
  creator: { id: string; name: string };
  pickupLocation: CreatedRideLocation;
  destinationLocation: CreatedRideLocation;
  departureDateTime: Date;
  totalSeats: number;
  vehicleType: string | null;
  discoveryRadiusKm: number | null;
  pricingType: PricingType;
  pricePerKm: number;
  estimatedDistanceKm: number | null;
  estimatedContribution: number | null;
  status: RideStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Persistence dependency, injectable for unit testing without PostgreSQL. */
export interface CreateRideDependencies {
  persistRide: (input: RideCreationInput) => Promise<PersistedRideRecord>;
}

function defaultDependencies(): CreateRideDependencies {
  return {
    persistRide: (input) => persistNewRide(prisma, input),
  };
}

/**
 * Application-level input checks that are not part of Phase 3.1's ride
 * field rules (seats/coordinates/pricing) — basic shape validation for
 * fields the domain layer does not own. Distance/contribution have no
 * defined calculation (map/distance provider = OD-007), so they are only
 * validated when supplied, never computed or required here (Phase 3.2 §11).
 */
function assertValidCreationShape(input: RideCreationInput): void {
  if (typeof input.creatorId !== 'string' || input.creatorId.trim() === '') {
    throw new ValidationError('creatorId is required', { field: 'creatorId' });
  }
  if (
    !(input.departureDateTime instanceof Date) ||
    Number.isNaN(input.departureDateTime.getTime())
  ) {
    throw new ValidationError('departureDateTime must be a valid date', {
      field: 'departureDateTime',
    });
  }
  if (
    input.discoveryRadiusKm !== undefined &&
    (!Number.isFinite(input.discoveryRadiusKm) || input.discoveryRadiusKm <= 0)
  ) {
    throw new ValidationError('discoveryRadiusKm must be a positive number', {
      field: 'discoveryRadiusKm',
      details: { discoveryRadiusKm: input.discoveryRadiusKm },
    });
  }
  if (
    input.estimatedDistanceKm !== undefined &&
    (!Number.isFinite(input.estimatedDistanceKm) ||
      input.estimatedDistanceKm < 0)
  ) {
    throw new ValidationError(
      'estimatedDistanceKm must be a non-negative number',
      {
        field: 'estimatedDistanceKm',
        details: { estimatedDistanceKm: input.estimatedDistanceKm },
      },
    );
  }
  if (
    input.estimatedContribution !== undefined &&
    (!Number.isFinite(input.estimatedContribution) ||
      input.estimatedContribution < 0)
  ) {
    throw new ValidationError(
      'estimatedContribution must be a non-negative number',
      {
        field: 'estimatedContribution',
        details: { estimatedContribution: input.estimatedContribution },
      },
    );
  }
}

/**
 * Creates a Ride for the given creator.
 *
 * Flow: validate input shape → validate ride domain fields (reusing Phase
 * 3.1's `assertValidRideFields`) → persist transactionally (creator lookup
 * + Ride + initial `RideStatusHistory`) → return a typed result.
 *
 * Throws `ValidationError`/`RideValidationError` for malformed input,
 * `NotFoundError` when `creatorId` does not correspond to an existing
 * user, or `InternalError` for unexpected persistence failures (never a
 * raw Prisma error).
 */
export async function createRide(
  input: RideCreationInput,
  deps: Partial<CreateRideDependencies> = {},
): Promise<CreatedRide> {
  const { persistRide } = { ...defaultDependencies(), ...deps };

  assertValidCreationShape(input);
  assertValidRideFields({
    totalSeats: input.totalSeats,
    pricingType: input.pricingType,
    pricePerKm: input.pricePerKm,
    pickup: input.pickup,
    destination: input.destination,
  });

  try {
    const record = await persistRide(input);
    return toCreatedRide(record);
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new InternalError('Failed to create ride', { cause: err });
  }
}
