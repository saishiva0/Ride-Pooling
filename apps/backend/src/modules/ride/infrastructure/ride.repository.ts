/**
 * Ride persistence (Phase 3.2).
 *
 * The only persistence concern this phase owns: creating a Ride (plus its
 * pickup/destination `Location` rows and its initial `RideStatusHistory`
 * row) transactionally. This is intentionally a small set of functions, not
 * a generic repository framework — see
 * `docs/architecture/module-boundaries.md` §5 (Ride Engine depends only on
 * Foundation + Database).
 */
import {
  ParticipantStatus,
  Prisma,
  PricingType,
  RideStatus,
} from '@prisma/client';
import type { PrismaClient, RideRequestStatus } from '@prisma/client';
import { NotFoundError } from '../../../lib/errors.js';
import { ACTIVE_REQUEST_STATUSES } from '../domain/request-rules.js';

/**
 * A ride is created in `DRAFT` (`docs/domain/ride-lifecycle.md` §2.1 —
 * "Entry conditions: Ride created"; `docs/domain/ride-engine.md` §4.1 —
 * "Output: ride in DRAFT"). Publication (`DRAFT → PUBLISHED`) is a
 * separate, later operation and is NOT part of ride creation.
 */
export const INITIAL_RIDE_STATUS: RideStatus = RideStatus.DRAFT;

/**
 * The ride statuses eligible for discovery (Phase 3.3).
 *
 * `docs/domain/matching-model.md` §2/§3/§4 defines discoverable candidates as
 * "status `PUBLISHED` or `CONFIRMED` (with seats)". `docs/domain/ride-lifecycle.md`
 * §2.2 makes `PUBLISHED` discoverable; §2.3 keeps `CONFIRMED` open to new
 * requests "while seats remain". `DRAFT` is never discoverable
 * (`ride-lifecycle.md` §2.1) and terminal states (`COMPLETED`/`CANCELLED`/
 * `EXPIRED`) are never returned. Seat availability is enforced separately by
 * the discovery query (`availableSeats > 0`), so a `CONFIRMED` ride with no
 * free seats is excluded too.
 */
export const DISCOVERABLE_RIDE_STATUSES: readonly RideStatus[] = [
  RideStatus.PUBLISHED,
  RideStatus.CONFIRMED,
];

/**
 * The spatial portion of a discovery query. The participant's requested
 * pickup point plus a search radius in meters; the database (PostGIS)
 * performs the distance filtering, never application code.
 *
 * `viewerId` (Phase 3.24 — Reporting & Blocking, §13, DECIDED) is the
 * authenticated caller's id. When present, rides created by a user with an
 * ACTIVE block against the viewer (in either direction) are excluded — a
 * single, isolated `NOT EXISTS` clause so the filter can be reverted in one
 * place (§21 rollback guidance). Optional and backward compatible: omitting
 * it (e.g. existing tests) applies no block filtering.
 */
export interface RideDiscoveryQuery {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  limit: number;
  viewerId?: string;
}

/** One raw row returned by the PostGIS discovery query. */
export interface DiscoveredRideRow {
  id: string;
  creatorId: string;
  creatorName: string;
  /**
   * Ride status, returned so the Phase 3.4 matching layer can evaluate its
   * "ride status" factor (`docs/domain/matching-model.md` §4). Discovery
   * still guarantees the value is `PUBLISHED`/`CONFIRMED`; it is carried
   * through as an additive field, not a behaviour change.
   */
  status: RideStatus;
  departureDateTime: Date;
  totalSeats: number;
  availableSeats: number;
  pricingType: PricingType;
  pricePerKm: number;
  pickupLocationId: string;
  pickupLatitude: number;
  pickupLongitude: number;
  pickupLabel: string | null;
  destinationLocationId: string;
  destinationLatitude: number;
  destinationLongitude: number;
  destinationLabel: string | null;
  distanceMeters: number;
}

export interface RideCreationLocationInput {
  latitude: number;
  longitude: number;
  label?: string;
}

/**
 * Everything required to persist a new Ride. Caller-supplied — does not
 * include `status`, `id`, `createdAt`, or `updatedAt`, which are controlled
 * by the application (`status`) or the database (the rest).
 */
export interface RideCreationInput {
  creatorId: string;
  pickup: RideCreationLocationInput;
  destination: RideCreationLocationInput;
  departureDateTime: Date;
  totalSeats: number;
  vehicleType?: string;
  discoveryRadiusKm?: number;
  pricingType: PricingType;
  pricePerKm: number;
  estimatedDistanceKm?: number;
  estimatedContribution?: number;
}

const RIDE_WITH_RELATIONS = {
  include: {
    creator: true,
    pickupLocation: true,
    destinationLocation: true,
  },
} satisfies Prisma.RideDefaultArgs;

export type PersistedRideRecord = Prisma.RideGetPayload<
  typeof RIDE_WITH_RELATIONS
>;

/**
 * Creates a Ride, its two `Location` rows, and its initial
 * `RideStatusHistory` row in a single transaction
 * (`docs/domain/ride-engine.md` §4.1; Phase 3.2 §9).
 *
 * All three writes succeed or fail together: if the creator does not
 * exist, or any write fails, the whole transaction rolls back — no partial
 * Ride, no orphaned Location, no orphaned status history.
 *
 * Only `client.$transaction` is required, so the parameter is narrowed to
 * that single capability rather than the full `PrismaClient` shape — this
 * keeps the function easy to call with the shared client in production and
 * easy to reason about in tests.
 */
export async function persistNewRide(
  client: Pick<PrismaClient, '$transaction'>,
  input: RideCreationInput,
): Promise<PersistedRideRecord> {
  return client.$transaction(async (tx) => {
    const creator = await tx.user.findUnique({
      where: { id: input.creatorId },
    });
    if (!creator) {
      throw new NotFoundError('Ride creator not found', {
        field: 'creatorId',
        details: { creatorId: input.creatorId },
      });
    }

    const pickupLocation = await tx.location.create({
      data: {
        latitude: input.pickup.latitude,
        longitude: input.pickup.longitude,
        label: input.pickup.label,
      },
    });
    const destinationLocation = await tx.location.create({
      data: {
        latitude: input.destination.latitude,
        longitude: input.destination.longitude,
        label: input.destination.label,
      },
    });

    const ride = await tx.ride.create({
      data: {
        creatorId: input.creatorId,
        pickupLocationId: pickupLocation.id,
        destinationLocationId: destinationLocation.id,
        departureDateTime: input.departureDateTime,
        totalSeats: input.totalSeats,
        vehicleType: input.vehicleType,
        discoveryRadiusKm: input.discoveryRadiusKm,
        pricingType: input.pricingType,
        pricePerKm: input.pricePerKm,
        estimatedDistanceKm: input.estimatedDistanceKm,
        estimatedContribution: input.estimatedContribution,
        status: INITIAL_RIDE_STATUS,
      },
      ...RIDE_WITH_RELATIONS,
    });

    await tx.rideStatusHistory.create({
      data: {
        rideId: ride.id,
        fromStatus: null,
        toStatus: INITIAL_RIDE_STATUS,
        changedByUserId: input.creatorId,
        reason: 'Ride created',
      },
    });

    return ride;
  });
}

// Discoverable statuses as parameterized SQL values (internal enum
// constants — never user input — still sent as prepared-statement bind
// parameters rather than concatenated into the SQL text).
const DISCOVERABLE_STATUS_PARAMETERS = Prisma.join(
  DISCOVERABLE_RIDE_STATUSES.map((status) => Prisma.sql`${status}`),
);

/**
 * Finds eligible rides whose pickup location is within `radiusMeters` of the
 * participant's requested pickup point (Phase 3.3 — DISCOVERY only).
 *
 * This is a candidate-retrieval mechanism, not matching: it filters by the
 * documented discovery criteria only — discoverable status
 * (`PUBLISHED`/`CONFIRMED`), seat availability (`availableSeats > 0`), and
 * pickup within radius — and orders by spatial proximity (nearest first) as
 * a simple deterministic presentation order. It performs no scoring, no
 * ranking, and no destination/time/seat compatibility evaluation (that is
 * Phase 3.4 matching).
 *
 * Spatial filtering happens entirely in the database:
 *
 *   participant pickup point
 *     → ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
 *     → ST_DWithin against the existing generated `Location.point` (cast to
 *       geography, WGS84) with a meter radius
 *     → rides whose pickup is within radius
 *
 * Coordinate order is `ST_MakePoint(longitude, latitude)` — the same order
 * the Phase 2 generated column uses (`migration.sql`). `distanceMeters` is
 * pickup-to-pickup distance via `ST_Distance` on geography; it is unrelated
 * to the ride's stored route distance (`estimatedDistanceKm`) and never
 * overwrites it.
 *
 * Read-only: performs no writes, no seat/status mutation, no history rows.
 *
 * Raw SQL is used because Prisma cannot express the PostGIS geography
 * operation; all interpolated values are Prisma parameterized bind
 * parameters (`Prisma.sql`), so no user input is ever concatenated into SQL.
 */
export async function discoverNearbyRides(
  client: Pick<PrismaClient, '$queryRaw'>,
  query: RideDiscoveryQuery,
): Promise<DiscoveredRideRow[]> {
  // Phase 3.24 (Reporting & Blocking, §13 — DECIDED): exclude rides created
  // by a user with an ACTIVE block against the viewer, in either direction.
  // A single isolated NOT EXISTS clause, backed by the `Block` unique index
  // and `Block_blockerId_unblockedAt_idx` — no change to the rest of the
  // discovery query's shape, ordering, or performance characteristics.
  const blockExclusion = query.viewerId
    ? Prisma.sql`
      AND NOT EXISTS (
        SELECT 1 FROM "Block" b
        WHERE b."unblockedAt" IS NULL
          AND (
            (b."blockerId" = ${query.viewerId} AND b."blockedId" = r."creatorId")
            OR (b."blockerId" = r."creatorId" AND b."blockedId" = ${query.viewerId})
          )
      )`
    : Prisma.empty;

  return client.$queryRaw<DiscoveredRideRow[]>(Prisma.sql`
    SELECT
      r."id",
      r."creatorId",
      u."name" AS "creatorName",
      r."status"::text AS "status",
      r."departureDateTime",
      r."totalSeats",
      (r."totalSeats" - COALESCE(ps."seatsAllocated"::int, 0)) AS "availableSeats",
      r."pricingType",
      r."pricePerKm"::double precision AS "pricePerKm",
      pl."id" AS "pickupLocationId",
      pl."latitude"::double precision AS "pickupLatitude",
      pl."longitude"::double precision AS "pickupLongitude",
      pl."label" AS "pickupLabel",
      dl."id" AS "destinationLocationId",
      dl."latitude"::double precision AS "destinationLatitude",
      dl."longitude"::double precision AS "destinationLongitude",
      dl."label" AS "destinationLabel",
      ST_Distance(
        ST_SetSRID(ST_MakePoint(${query.longitude}, ${query.latitude}), 4326)::geography,
        pl."point"::geography
      ) AS "distanceMeters"
    FROM "Ride" r
    JOIN "User" u ON u."id" = r."creatorId"
    JOIN "Location" pl ON pl."id" = r."pickupLocationId"
    JOIN "Location" dl ON dl."id" = r."destinationLocationId"
    LEFT JOIN (
      SELECT rp."rideId", SUM(rp."seatsAllocated") AS "seatsAllocated"
      FROM "RideParticipant" rp
      WHERE rp."status" = 'CONFIRMED'
      GROUP BY rp."rideId"
    ) ps ON ps."rideId" = r."id"
    WHERE r."status"::text IN (${DISCOVERABLE_STATUS_PARAMETERS})
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(${query.longitude}, ${query.latitude}), 4326)::geography,
        pl."point"::geography,
        ${query.radiusMeters}
      )
      AND (r."totalSeats" - COALESCE(ps."seatsAllocated", 0)) > 0
      ${blockExclusion}
    ORDER BY "distanceMeters" ASC, r."id" ASC
    LIMIT ${query.limit}
  `);
}

// ---------------------------------------------------------------------------
// Ride request persistence (Phase 3.5 — REQUEST CREATION only)
// ---------------------------------------------------------------------------
//
// These functions operate inside the application service's transaction (the
// transaction client is passed in) and own every Prisma/Postgres detail for
// request creation: requester lookup, ride lookup (with live available seats
// computed like discovery), active-duplicate lookup, and the insert. They
// contain NO business rules — request eligibility/self-request/seat rules
// live in `domain/request-rules.ts` and the application service.

/** The subset of a ride request creation needs. */
export interface RequestableRideRow {
  id: string;
  creatorId: string;
  status: RideStatus;
  /**
   * Live free seats = totalSeats − confirmed participants' allocated seats,
   * computed in SQL (same formula discovery uses). Only read; never mutated.
   */
  availableSeats: number;
}

/** Data required to persist a new RideRequest. */
export interface RideRequestCreationParams {
  rideId: string;
  userId: string;
  requestedSeats: number;
  status: RideRequestStatus;
}

/** The raw persisted request row returned to the application layer. */
export interface PersistedRideRequest {
  id: string;
  rideId: string;
  userId: string;
  requestedSeats: number;
  status: RideRequestStatus;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

/** Looks up a potential requester by id (identity check for the FK). */
export async function findRequester(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<{ id: string; name: string } | null> {
  return tx.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true },
  });
}

/**
 * Looks up a ride plus its live available seats (raw SQL, mirroring the
 * discovery seat formula). Returns null when the ride does not exist.
 */
export async function findRideForRequest(
  tx: Prisma.TransactionClient,
  rideId: string,
): Promise<RequestableRideRow | null> {
  const rows = await tx.$queryRaw<RequestableRideRow[]>(Prisma.sql`
    SELECT
      r."id",
      r."creatorId",
      r."status"::text AS "status",
      (r."totalSeats" - COALESCE(ps."seatsAllocated"::int, 0)) AS "availableSeats"
    FROM "Ride" r
    LEFT JOIN (
      SELECT rp."rideId", SUM(rp."seatsAllocated") AS "seatsAllocated"
      FROM "RideParticipant" rp
      WHERE rp."status" = 'CONFIRMED'
      GROUP BY rp."rideId"
    ) ps ON ps."rideId" = r."id"
    WHERE r."id" = ${rideId}
  `);
  return rows[0] ?? null;
}

/**
 * Finds an existing active request (status in PENDING/ACCEPTED) from the
 * same user for the same ride — the application-side duplicate check. The
 * database partial unique index `RideRequest_active_unique` remains the
 * final protection against races.
 */
export async function findActiveRideRequest(
  tx: Prisma.TransactionClient,
  rideId: string,
  userId: string,
): Promise<{ id: string } | null> {
  return tx.rideRequest.findFirst({
    where: {
      rideId,
      userId,
      status: { in: [...ACTIVE_REQUEST_STATUSES] },
    },
    select: { id: true },
  });
}

/** Inserts a RideRequest inside the caller's transaction. */
export async function persistRideRequest(
  tx: Prisma.TransactionClient,
  params: RideRequestCreationParams,
): Promise<PersistedRideRequest> {
  return tx.rideRequest.create({
    data: params,
    select: {
      id: true,
      rideId: true,
      userId: true,
      requestedSeats: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      resolvedAt: true,
    },
  });
}

/**
 * Classifies a Prisma error thrown by a request insert so the application
 * layer can translate races/FK violations into its own error structure
 * (never a raw Prisma error):
 *
 * - `unique` → concurrent duplicate active request (P2002 on
 *   `RideRequest_active_unique`).
 * - `foreign_key` → requester/ride vanished between lookup and insert
 *   (P2003).
 * - `null` → anything else.
 */
export function classifyRideRequestError(
  err: unknown,
): 'unique' | 'foreign_key' | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return 'unique';
    }
    if (err.code === 'P2003') {
      return 'foreign_key';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Request acceptance / rejection persistence (Phase 3.6)
// ---------------------------------------------------------------------------
//
// These functions run inside the application service's transaction (the
// transaction client is passed in) and own every Prisma/Postgres detail for
// request decisions: request lookup, ride row locking (FOR UPDATE), confirmed
// seat accounting, participant insert, request status update, ride status
// update, and ride status history. They contain NO business rules — the
// decision rules live in `domain/decision-rules.ts` and the application
// service. The row lock here is the serialization point that makes seat
// allocation race-safe (see `docs/development/phase-3-6-notes.md`).

/** A ride row locked for a decision (FOR UPDATE), with its live status. */
export interface LockedRideRow {
  id: string;
  creatorId: string;
  status: RideStatus;
  totalSeats: number;
}

/** Data required to create a RideParticipant for an accepted request. */
export interface RideParticipantCreationParams {
  rideId: string;
  userId: string;
  requestId: string;
  seatsAllocated: number;
  status: ParticipantStatus;
}

/** The raw persisted participant row returned to the application layer. */
export interface PersistedRideParticipant {
  id: string;
  rideId: string;
  userId: string;
  requestId: string;
  seatsAllocated: number;
  status: ParticipantStatus;
  joinedAt: Date;
}

/**
 * Loads a RideRequest by id. Used twice by the decision use cases: first to
 * discover which ride to lock, then again after the ride lock is held (the
 * authoritative status read — see `docs/development/phase-3-6-notes.md`).
 */
export async function findRideRequest(
  tx: Prisma.TransactionClient,
  requestId: string,
): Promise<PersistedRideRequest | null> {
  return tx.rideRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      rideId: true,
      userId: true,
      requestedSeats: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      resolvedAt: true,
    },
  });
}

/**
 * A Ride row locked for a lifecycle operation (cancel/expire), with the
 * departure datetime needed for expiration eligibility in addition to the
 * creator/status used by authorization and state rules.
 */
export interface LockedRideLifecycleRow {
  id: string;
  creatorId: string;
  status: RideStatus;
  departureDateTime: Date;
}

/**
 * Locks a Ride row for a lifecycle operation (cancellation / expiration)
 * using PostgreSQL row-level locking (`SELECT ... FOR UPDATE`) — the same
 * locking convention as `lockRideForDecision`. Prisma cannot express
 * `FOR UPDATE`, so this is a parameterized raw query — all interpolated
 * values are prepared-statement bind parameters, never concatenated SQL.
 *
 * The lock serializes every lifecycle operation AND every Phase 3.6 decision
 * for the same ride (they share the same ride-row lock), so cancellation and
 * expiration cannot interleave with request acceptance/rejection: a
 * concurrent operation blocks here until the holder commits, then re-reads
 * the current state. `departureDateTime` is returned so expiration can
 * evaluate its time window against the authoritative row.
 */
export async function lockRideForLifecycle(
  tx: Prisma.TransactionClient,
  rideId: string,
): Promise<LockedRideLifecycleRow | null> {
  const rows = await tx.$queryRaw<LockedRideLifecycleRow[]>(Prisma.sql`
    SELECT
      r."id",
      r."creatorId",
      r."status"::text AS "status",
      r."departureDateTime"
    FROM "Ride" r
    WHERE r."id" = ${rideId}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

/**
 * Locks a Ride row for a request decision using PostgreSQL row-level locking
 * (`SELECT ... FOR UPDATE`). Prisma cannot express `FOR UPDATE`, so this is a
 * parameterized raw query — all interpolated values are prepared-statement
 * bind parameters, never concatenated SQL.
 *
 * The lock serializes every decision (accept/reject) for the same ride: a
 * concurrent decision blocks here until the holder commits, then re-reads the
 * current state. Combined with the confirmed-seat sum read *after* the lock,
 * this makes seat allocation race-safe (no overbooking) without weakening any
 * database constraint.
 */
export async function lockRideForDecision(
  tx: Prisma.TransactionClient,
  rideId: string,
): Promise<LockedRideRow | null> {
  const rows = await tx.$queryRaw<LockedRideRow[]>(Prisma.sql`
    SELECT
      r."id",
      r."creatorId",
      r."status"::text AS "status",
      r."totalSeats"
    FROM "Ride" r
    WHERE r."id" = ${rideId}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

/**
 * Sums the seats allocated to CONFIRMED participants of a ride. This is the
 * single source of truth for seat usage (`docs/domain/ride-engine.md` §4.8:
 * available = total − confirmed allocated), computed inside the locked
 * transaction so the value is stable for the duration of the decision.
 */
export async function countConfirmedParticipantSeats(
  tx: Prisma.TransactionClient,
  rideId: string,
): Promise<number> {
  const result = await tx.rideParticipant.aggregate({
    where: { rideId, status: ParticipantStatus.CONFIRMED },
    _sum: { seatsAllocated: true },
  });
  return result._sum.seatsAllocated ?? 0;
}

/**
 * Returns the userIds of a ride's CONFIRMED participants (the "affected
 * users" notified on ride cancel/expire — `ride-lifecycle.md` §2.6/§2.7, and
 * `RIDE_CONFIRMED` recipients per §2.3).
 */
export async function findConfirmedParticipantUserIds(
  tx: Prisma.TransactionClient,
  rideId: string,
): Promise<string[]> {
  const rows = await tx.rideParticipant.findMany({
    where: { rideId, status: ParticipantStatus.CONFIRMED },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
}

/**
 * Looks up a participant by its originating request. `requestId` is `@unique`
 * on RideParticipant (Phase 2), so at most one row can exist. Used as a
 * defense-in-depth duplicate check; the unique index remains the final
 * arbiter of races.
 */
export async function findParticipantByRequest(
  tx: Prisma.TransactionClient,
  requestId: string,
): Promise<{ id: string } | null> {
  return tx.rideParticipant.findUnique({
    where: { requestId },
    select: { id: true },
  });
}

/** Inserts a RideParticipant inside the caller's transaction. */
export async function persistRideParticipant(
  tx: Prisma.TransactionClient,
  params: RideParticipantCreationParams,
): Promise<PersistedRideParticipant> {
  return tx.rideParticipant.create({
    data: params,
    select: {
      id: true,
      rideId: true,
      userId: true,
      requestId: true,
      seatsAllocated: true,
      status: true,
      joinedAt: true,
    },
  });
}

/** Updates a RideRequest's status (and resolution timestamp) in one write. */
export async function updateRideRequestStatus(
  tx: Prisma.TransactionClient,
  params: {
    requestId: string;
    status: RideRequestStatus;
    resolvedAt: Date;
  },
): Promise<PersistedRideRequest> {
  return tx.rideRequest.update({
    where: { id: params.requestId },
    data: { status: params.status, resolvedAt: params.resolvedAt },
    select: {
      id: true,
      rideId: true,
      userId: true,
      requestedSeats: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      resolvedAt: true,
    },
  });
}

/** Updates a Ride's status (used for the first-accept PUBLISHED → CONFIRMED). */
export async function updateRideStatus(
  tx: Prisma.TransactionClient,
  params: { rideId: string; status: RideStatus },
): Promise<{ id: string; status: RideStatus }> {
  return tx.ride.update({
    where: { id: params.rideId },
    data: { status: params.status },
    select: { id: true, status: true },
  });
}

/** Appends a RideStatusHistory row inside the caller's transaction. */
export async function persistRideStatusHistory(
  tx: Prisma.TransactionClient,
  params: {
    rideId: string;
    fromStatus: RideStatus | null;
    toStatus: RideStatus;
    /**
     * The user who changed the ride status, or `null` for system-initiated
     * changes such as expiration (`docs/domain/ride-lifecycle.md` §2.7 —
     * actor: System). The column is nullable (`schema.prisma`).
     */
    changedByUserId: string | null;
    reason: string;
  },
): Promise<{ id: string }> {
  return tx.rideStatusHistory.create({
    data: params,
    select: { id: true },
  });
}

/**
 * Classifies a Prisma error thrown by a lifecycle write (ride status update /
 * status history insert) so the application layer can translate it into its
 * own error structure (never a raw Prisma error):
 *
 * - `not_found` → P2025: the ride row vanished between the lock read and the
 *   update (an operation that depends on a record that no longer exists).
 * - `foreign_key` → P2003: a referenced row (e.g. the actor) vanished between
 *   the lock read and the history insert.
 * - `null` → anything else.
 */
export function classifyRideLifecycleError(
  err: unknown,
): 'not_found' | 'foreign_key' | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      return 'not_found';
    }
    if (err.code === 'P2003') {
      return 'foreign_key';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Request / participation cancellation persistence (Phase 3.21)
// ---------------------------------------------------------------------------
//
// These functions run inside the application service's transaction (the
// transaction client is passed in) and own every Prisma detail for request
// withdrawal (PENDING → CANCELLED) and participation cancellation (ACCEPTED
// participation → CANCELLED + seat release + optional CONFIRMED → PUBLISHED
// revert). They contain NO business rules — the cancellation rules live in
// `domain/request-cancellation-rules.ts` and the application service. The
// operation shares the Phase 3.6 ride-row lock, so cancellation serializes
// with every other decision/lifecycle operation for the ride.

/** The participant row a participation cancellation needs. */
export interface CancelableParticipantRow {
  id: string;
  userId: string;
  seatsAllocated: number;
  status: ParticipantStatus;
}

/**
 * Loads the RideParticipant for a request, with the seat/status fields the
 * cancellation use case needs. `requestId` is `@unique` on RideParticipant
 * (Phase 2), so at most one row can exist.
 */
export async function findParticipantForCancellation(
  tx: Prisma.TransactionClient,
  requestId: string,
): Promise<CancelableParticipantRow | null> {
  return tx.rideParticipant.findUnique({
    where: { requestId },
    select: {
      id: true,
      userId: true,
      seatsAllocated: true,
      status: true,
    },
  });
}

/**
 * Marks a participant CANCELLED and stamps `cancelledAt`. Setting the status
 * frees the participant's seats: every seat formula in this module sums only
 * CONFIRMED participants, so the freed seats become available again without
 * any explicit seat counter.
 */
export async function cancelRideParticipant(
  tx: Prisma.TransactionClient,
  params: { id: string; cancelledAt: Date },
): Promise<{ id: string; status: ParticipantStatus }> {
  return tx.rideParticipant.update({
    where: { id: params.id },
    data: {
      status: ParticipantStatus.CANCELLED,
      cancelledAt: params.cancelledAt,
    },
    select: { id: true, status: true },
  });
}

/**
 * Classifies a Prisma error thrown by a cancellation write (participant /
 * request status update, ride status update, history insert) so the
 * application layer can translate it into its own error structure (never a
 * raw Prisma error):
 *
 * - `not_found` → P2025: a row vanished between the lock read and the write
 *   (e.g. the participant was removed by a concurrent operation).
 * - `foreign_key` → P2003: a referenced row (e.g. the actor) vanished between
 *   the lock read and the history insert.
 * - `null` → anything else.
 */
export function classifyRideCancellationError(
  err: unknown,
): 'not_found' | 'foreign_key' | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      return 'not_found';
    }
    if (err.code === 'P2003') {
      return 'foreign_key';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Creator read path persistence (Phase 3.17)
// ---------------------------------------------------------------------------
//
// Read-only functions for the authenticated creator's own rides ("My Rides").
// They contain NO business rules — creator authorization and lifecycle rules
// live in `domain/lifecycle-rules.ts` and the application services. Seat
// availability is computed with the same formula the rest of the module uses
// (available = totalSeats − CONFIRMED participants' allocated seats), read
// inside the same transaction as the rides so the view is consistent.

/** A ride plus its live available seats, as returned to the creator view. */
export interface PersistedCreatorRide {
  ride: PersistedRideRecord;
  availableSeats: number;
}

/**
 * Looks up a single ride with relations for a creator view, along with its
 * live available seats (same seat formula as discovery/requests). Returns
 * `null` when the ride does not exist. Read-only.
 */
export async function findCreatorRide(
  tx: Prisma.TransactionClient,
  rideId: string,
): Promise<PersistedCreatorRide | null> {
  const ride = await tx.ride.findUnique({
    where: { id: rideId },
    ...RIDE_WITH_RELATIONS,
  });
  if (!ride) {
    return null;
  }
  const allocated = await countConfirmedParticipantSeats(tx, rideId);
  return { ride, availableSeats: ride.totalSeats - allocated };
}

/**
 * Lists a creator's own rides with their live available seats, ordered by
 * `departureDateTime` ascending (the documented presentation order for the
 * creator's ride list — earliest departure first; no pagination in this
 * phase, per the canonical Phase 3.17 spec). Read-only.
 */
export async function listCreatorRides(
  tx: Prisma.TransactionClient,
  creatorId: string,
): Promise<PersistedCreatorRide[]> {
  const rides = await tx.ride.findMany({
    where: { creatorId },
    orderBy: { departureDateTime: 'asc' },
    ...RIDE_WITH_RELATIONS,
  });
  if (rides.length === 0) {
    return [];
  }
  const seats = await tx.rideParticipant.groupBy({
    by: ['rideId'],
    where: {
      rideId: { in: rides.map((ride) => ride.id) },
      status: ParticipantStatus.CONFIRMED,
    },
    _sum: { seatsAllocated: true },
  });
  const seatsByRide = new Map(
    seats.map((row) => [row.rideId, row._sum.seatsAllocated ?? 0]),
  );
  return rides.map((ride) => ({
    ride,
    availableSeats: ride.totalSeats - (seatsByRide.get(ride.id) ?? 0),
  }));
}
