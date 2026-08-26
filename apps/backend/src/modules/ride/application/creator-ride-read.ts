/**
 * Shared application plumbing for the creator read path (Phase 3.17).
 *
 * Both creator view use cases (`list-creator-rides.ts`, `get-ride-detail.ts`)
 * share: the `CreatorRide` application shape (the existing `CreatedRide`
 * extended with live seat availability), its mapping (reusing
 * `toCreatedRide`, never duplicated), and the default transaction wiring —
 * mirroring the Phase 3.7 pattern (`ride-lifecycle.ts`): all Prisma details
 * stay in the repository, the application layer depends only on this shape,
 * and reads run inside a single `prisma.$transaction` so each ride and its
 * seat sum are a consistent snapshot.
 */
import { prisma } from '../../../lib/prisma.js';
import {
  findCreatorRide,
  listCreatorRides,
  type PersistedCreatorRide,
} from '../infrastructure/ride.repository.js';
import { toCreatedRide, type CreatedRide } from './create-ride.js';

/**
 * A ride as seen by its creator ("My Rides" / "Active Ride" / "Ride History" /
 * creator detail): the full `CreatedRide` shape plus live available seats
 * (the same seat formula the rest of the module uses). No raw Prisma types.
 */
export interface CreatorRide extends CreatedRide {
  /** totalSeats − CONFIRMED participants' allocated seats (never negative). */
  availableSeats: number;
}

/** Maps a persisted creator ride record to the application shape. */
export function toCreatorRide(record: PersistedCreatorRide): CreatorRide {
  return {
    ...toCreatedRide(record.ride),
    availableSeats: record.availableSeats,
  };
}

/** Persistence port for the creator read path, bound to one transaction. */
export interface CreatorRideReadPersistence {
  /** Lists the creator's own rides (departureDateTime ASC). */
  listCreatorRides(creatorId: string): Promise<PersistedCreatorRide[]>;
  /** Looks up a single ride with its live seat sum; null when missing. */
  findCreatorRide(rideId: string): Promise<PersistedCreatorRide | null>;
}

/** Injected dependency so the read use cases are unit-testable without DB. */
export interface RideCreatorReadDependencies {
  runTransaction: <T>(
    work: (persistence: CreatorRideReadPersistence) => Promise<T>,
  ) => Promise<T>;
}

/** Default dependency wiring: a single interactive `prisma.$transaction`. */
export function defaultCreatorRideReadDependencies(): RideCreatorReadDependencies {
  return {
    runTransaction: (work) =>
      prisma.$transaction(async (tx) =>
        work({
          listCreatorRides: (creatorId) => listCreatorRides(tx, creatorId),
          findCreatorRide: (rideId) => findCreatorRide(tx, rideId),
        }),
      ),
  };
}
