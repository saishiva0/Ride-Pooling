/**
 * Matching types (Phase 3.4 — RIDE MATCHING).
 *
 * The authoritative specification is `docs/domain/matching-model.md`. It
 * defines exactly five deterministic factors (in priority order), an
 * eligible/not-eligible decision (all five conditions ANDed, §9), and a
 * deterministic relevance sort (§5). It deliberately defines NO numerical
 * score — OD-004 (resolved Phase 3.19) confirmed that V1 uses no numeric
 * relevance score: the deterministic, explainable factor results and
 * proximity ranking are authoritative.
 *
 * Thresholds are carried in an explicit `MatchingConfiguration` supplied by
 * the application layer (built from server-controlled config — OD-004); the
 * domain never silently defaults a value.
 */
import type { RideStatus } from '@prisma/client';
import type { RideCoordinates } from '../ride.types.js';

/**
 * The five documented matching factors (`docs/domain/matching-model.md` §4),
 * in documented priority order. These identifiers are the canonical factor
 * names used in results and explanations.
 */
export const MATCH_FACTOR_IDS = {
  PICKUP_PROXIMITY: 'pickupProximity',
  DESTINATION_COMPATIBILITY: 'destinationCompatibility',
  TIME_COMPATIBILITY: 'timeCompatibility',
  SEAT_AVAILABILITY: 'seatAvailability',
  RIDE_STATUS: 'rideStatus',
} as const;

export type MatchFactorId =
  (typeof MATCH_FACTOR_IDS)[keyof typeof MATCH_FACTOR_IDS];

/**
 * Matching thresholds (`docs/domain/matching-model.md` §6, OD-004 — resolved
 * Phase 3.19).
 *
 * These are the APPROVED V1 server-controlled values (5,000 m pickup radius,
 * ±60 min departure window, 5,000 m destination tolerance). The domain
 * evaluates factors against these values but never chooses them; the
 * application layer builds them from centralized server config
 * (`src/config`) so HTTP callers can never supply them.
 */
export interface MatchingConfiguration {
  /** Pickup proximity: participant within this pickup radius (meters). */
  pickupRadiusMeters: number;
  /** Time compatibility: departure within ± this window (minutes). */
  departureTimeWindowMinutes: number;
  /**
   * Destination compatibility: participant destination within this
   * straight-line tolerance of the ride destination (meters). The
   * "on-route / detour" alternative requires the routing provider decision
   * (OD-007); the straight-line fallback is the documented V1 approach
   * (matching-model.md §7).
   */
  destinationToleranceMeters: number;
}

/**
 * The participant's requested journey data the documented factors need
 * (`docs/domain/matching-model.md` §3, §7). Fields are limited to what the
 * five factors consume — no speculative fields.
 *
 * Pickup-to-pickup distance is not part of this input: discovery already
 * computed it for each candidate (`DiscoveredRide.distanceMeters`), and
 * matching reuses that value for the pickup-proximity factor.
 */
export interface RideMatchingInput {
  /** Participant's requested destination (destination-compatibility factor). */
  destination: RideCoordinates;
  /** Participant's preferred departure time (time-compatibility factor). */
  preferredDepartureTime: Date;
  /**
   * Requested seat count (seat-availability factor). Defaults to 1 when
   * omitted — matching-model.md §3: "Available seats ≥ 1 (or requested
   * count)".
   */
  requestedSeats?: number;
}

/**
 * A discovered ride reduced to the fields matching needs.
 *
 * Derived from `DiscoveredRide` by the application layer, keeping the domain
 * free of application-layer and Prisma types. `pickupDistanceMeters` reuses
 * discovery's pickup-to-pickup distance (never recomputed here).
 */
export interface MatchCandidate {
  id: string;
  /** Ride status (ride-status factor). */
  status: RideStatus;
  departureDateTime: Date;
  availableSeats: number;
  /** Pickup-to-pickup distance already computed by discovery (meters). */
  pickupDistanceMeters: number;
  /** Ride destination coordinates (destination-compatibility factor). */
  destination: RideCoordinates;
}

/**
 * A structured, explainable result for one factor (§13). `value`/`threshold`
 * carry the measured quantity and the configured threshold when applicable,
 * so a future UI can explain why a factor passed or failed without opaque
 * strings.
 */
export interface FactorResult {
  /** Canonical factor identifier (see `MATCH_FACTOR_IDS`). */
  factor: MatchFactorId;
  /** Whether this factor passed. */
  eligible: boolean;
  /** Deterministic, human-readable explanation. */
  reason: string;
  /** Measured value compared (unit depends on the factor). */
  value?: number | string;
  /** Configured threshold it was compared against, when applicable. */
  threshold?: number;
}

/** Result of evaluating one candidate against all five factors. */
export interface CandidateMatchResult {
  candidateId: string;
  /** All five factors passed (matching-model.md §9 — conditions are ANDed). */
  eligible: boolean;
  /** All five factors, in documented priority order. */
  factors: FactorResult[];
}
