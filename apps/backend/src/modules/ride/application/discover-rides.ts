/**
 * Ride discovery use case (Phase 3.3).
 *
 * Answers: "which published rides are geographically near this participant's
 * requested pickup point and otherwise eligible to be discovered?" It is a
 * candidate-retrieval mechanism — it deliberately does NOT score, rank, or
 * pick a best ride. Matching (destination/time/seat compatibility scoring)
 * is Phase 3.4.
 *
 * Orchestrates:
 *
 *   input validation → repository discovery (PostGIS) → result mapping
 *
 * Input validation reuses the Phase 3.1 coordinate predicates
 * (`isValidLatitude`/`isValidLongitude`) so coordinate bounds are not
 * duplicated. All spatial filtering happens in the database (PostGIS); this
 * module never computes distances in application code.
 */
import type { PricingType, RideStatus } from '@prisma/client';
import {
  AppError,
  InternalError,
  ValidationError,
} from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { isValidLatitude, isValidLongitude } from '../domain/ride-rules.js';
import {
  discoverNearbyRides,
  type DiscoveredRideRow,
  type RideDiscoveryQuery,
} from '../infrastructure/ride.repository.js';

/**
 * A strongly typed discovery input. Minimum documented discovery fields only
 * (`docs/domain/matching-model.md` §7 — participant pickup lat/lng + search
 * radius). Future filters (destination, departure time, vehicle type,
 * preferences) are matching concerns and are intentionally absent.
 *
 * `limit` is optional and NOT a product decision: it is a deterministic
 * safety/performance cap on results (see `DEFAULT_DISCOVERY_LIMIT`).
 */
export interface RideDiscoveryInput {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  limit?: number;
  /**
   * The authenticated caller's id (Phase 3.24 — Reporting & Blocking, §13 —
   * DECIDED). When present, rides created by a user with an active block
   * against the viewer (either direction) are excluded from the results.
   * Optional so existing callers/tests that discover anonymously are
   * unaffected.
   */
  viewerId?: string;
}

/**
 * Result limit applied when the caller does not provide one. This is an
 * implementation decision (a safety/performance guard for candidate
 * retrieval), not a product decision — no documented limit exists in
 * `docs/domain/matching-model.md` or the PRD. Kept configurable per-call via
 * `limit` so it is not an unexplained magic number in the query.
 */
export const DEFAULT_DISCOVERY_LIMIT = 20;

/** One discovered ride, shaped for application-layer consumers. */
export interface DiscoveredRide {
  id: string;
  creator: { id: string; name: string };
  pickupLocation: {
    id: string;
    latitude: number;
    longitude: number;
    label: string | null;
  };
  destinationLocation: {
    id: string;
    latitude: number;
    longitude: number;
    label: string | null;
  };
  departureDateTime: Date;
  totalSeats: number;
  availableSeats: number;
  pricingType: PricingType;
  pricePerKm: number;
  /** Straight-line pickup-to-pickup distance from the requested point (meters). */
  distanceMeters: number;
  /**
   * Ride status (`PUBLISHED`/`CONFIRMED` — discovery guarantees discoverable
   * statuses). Carried through for the Phase 3.4 matching layer's ride-status
   * factor; additive, not a discovery behaviour change.
   */
  status: RideStatus;
}

/** Persistence dependency, injectable for unit testing without PostgreSQL. */
export interface DiscoverRidesDependencies {
  discoverRidesQuery: (
    query: RideDiscoveryQuery,
  ) => Promise<DiscoveredRideRow[]>;
}

function defaultDependencies(): DiscoverRidesDependencies {
  return {
    discoverRidesQuery: (query) => discoverNearbyRides(prisma, query),
  };
}

/**
 * Application-level input checks for discovery. Coordinates reuse the Phase
 * 3.1 domain predicates; radius and limit are shape checks (the domain layer
 * owns ride fields, not the discovery query shape).
 */
function assertValidDiscoveryInput(input: RideDiscoveryInput): void {
  if (!isValidLatitude(input.latitude)) {
    throw new ValidationError(
      'latitude must be a finite number between -90 and 90',
      {
        field: 'latitude',
        details: { latitude: input.latitude },
      },
    );
  }
  if (!isValidLongitude(input.longitude)) {
    throw new ValidationError(
      'longitude must be a finite number between -180 and 180',
      {
        field: 'longitude',
        details: { longitude: input.longitude },
      },
    );
  }
  if (!Number.isFinite(input.radiusMeters) || input.radiusMeters <= 0) {
    throw new ValidationError('radiusMeters must be a finite positive number', {
      field: 'radiusMeters',
      details: { radiusMeters: input.radiusMeters },
    });
  }
  if (
    input.limit !== undefined &&
    (!Number.isInteger(input.limit) || input.limit <= 0)
  ) {
    throw new ValidationError('limit must be a positive integer', {
      field: 'limit',
      details: { limit: input.limit },
    });
  }
}

function toDiscoveredRide(row: DiscoveredRideRow): DiscoveredRide {
  return {
    id: row.id,
    creator: { id: row.creatorId, name: row.creatorName },
    pickupLocation: {
      id: row.pickupLocationId,
      latitude: row.pickupLatitude,
      longitude: row.pickupLongitude,
      label: row.pickupLabel,
    },
    destinationLocation: {
      id: row.destinationLocationId,
      latitude: row.destinationLatitude,
      longitude: row.destinationLongitude,
      label: row.destinationLabel,
    },
    departureDateTime: row.departureDateTime,
    totalSeats: row.totalSeats,
    availableSeats: row.availableSeats,
    pricingType: row.pricingType,
    pricePerKm: row.pricePerKm,
    distanceMeters: row.distanceMeters,
    status: row.status,
  };
}

/**
 * Discovers eligible rides near the requested pickup point.
 *
 * Flow: validate input → resolve the repository query (applying the default
 * result limit) → run PostGIS discovery → map raw rows to a strongly typed
 * result. Read-only; no business side effects.
 *
 * Throws `ValidationError` for malformed input or `InternalError` for
 * unexpected persistence failures (never a raw Prisma error).
 */
export async function discoverRides(
  input: RideDiscoveryInput,
  deps: Partial<DiscoverRidesDependencies> = {},
): Promise<DiscoveredRide[]> {
  const { discoverRidesQuery } = { ...defaultDependencies(), ...deps };

  assertValidDiscoveryInput(input);

  const query: RideDiscoveryQuery = {
    latitude: input.latitude,
    longitude: input.longitude,
    radiusMeters: input.radiusMeters,
    limit: input.limit ?? DEFAULT_DISCOVERY_LIMIT,
    viewerId: input.viewerId,
  };

  try {
    const rows = await discoverRidesQuery(query);
    return rows.map(toDiscoveredRide);
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new InternalError('Failed to discover rides', { cause: err });
  }
}
