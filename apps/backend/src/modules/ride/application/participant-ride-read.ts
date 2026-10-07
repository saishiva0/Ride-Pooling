/**
 * Shared application plumbing for the participant read path (V1 rider read
 * path).
 *
 * The authenticated participant's two read capabilities — their own ride
 * requests ("My Requests", server-authoritative) and the rides they are a
 * CONFIRMED participant of ("joined rides") — share: the application shapes,
 * their mapping (reusing `toCreatorRide`, never duplicating the ride DTO), and
 * the default transaction wiring. All Prisma details stay in the repository;
 * the application layer depends only on these shapes. Reads run in a single
 * `prisma.$transaction` so each ride and its seat sum are a consistent
 * snapshot, mirroring the Phase 3.17 creator read path.
 */
import type { RideRequestStatus } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import {
  listConfirmedParticipantRides,
  listParticipantRideRequests,
  type PersistedCreatorRide,
  type PersistedParticipantRideRequest,
} from '../infrastructure/ride.repository.js';
import { toCreatorRide, type CreatorRide } from './creator-ride-read.js';

/**
 * A participant's own request plus the requested ride — the full creator-ride
 * shape (reused for the mobile ride summary) and the request's own fields. No
 * raw Prisma types.
 */
export interface ParticipantRideRequest {
  request: {
    id: string;
    rideId: string;
    requestedSeats: number;
    status: RideRequestStatus;
    createdAt: Date;
    resolvedAt: Date | null;
  };
  ride: CreatorRide;
}

/** Maps a persisted participant-request record to the application shape. */
export function toParticipantRideRequest(
  record: PersistedParticipantRideRequest,
): ParticipantRideRequest {
  return {
    request: {
      id: record.request.id,
      rideId: record.request.rideId,
      requestedSeats: record.request.requestedSeats,
      status: record.request.status,
      createdAt: record.request.createdAt,
      resolvedAt: record.request.resolvedAt,
    },
    ride: toCreatorRide(record),
  };
}

/** Persistence port for the participant read path, bound to one transaction. */
export interface ParticipantRideReadPersistence {
  /** The user's own requests (any status), oldest first, with their rides. */
  listParticipantRequests(
    userId: string,
  ): Promise<PersistedParticipantRideRequest[]>;
  /** The rides the user is a CONFIRMED participant of (departure ASC). */
  listConfirmedRides(userId: string): Promise<PersistedCreatorRide[]>;
}

/** Injected dependency so the read use cases are unit-testable without DB. */
export interface ParticipantRideReadDependencies {
  runTransaction: <T>(
    work: (persistence: ParticipantRideReadPersistence) => Promise<T>,
  ) => Promise<T>;
}

/** Default dependency wiring: a single interactive `prisma.$transaction`. */
export function defaultParticipantRideReadDependencies(): ParticipantRideReadDependencies {
  return {
    runTransaction: (work) =>
      prisma.$transaction(async (tx) =>
        work({
          listParticipantRequests: (userId) =>
            listParticipantRideRequests(tx, userId),
          listConfirmedRides: (userId) =>
            listConfirmedParticipantRides(tx, userId),
        }),
      ),
  };
}
