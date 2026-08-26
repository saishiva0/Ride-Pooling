/**
 * Ride matching use case (Phase 3.4 — RIDE MATCHING).
 *
 * Answers: "how well does each discovered ride fit the participant's
 * requested journey?" It evaluates candidates produced by discovery
 * (`DiscoveredRide[]`) against the five documented factors
 * (`docs/domain/matching-model.md` §4), applies the ANDed eligibility
 * decision (§9), and ranks deterministically (§5).
 *
 *   DiscoveredRide[]
 *        ↓ map to MatchCandidate (domain shape)
 *        ↓ evaluateCandidateMatch (pure, all 5 factors)
 *        ↓ rankMatches (deterministic sort + tie-break)
 *        ↓ MatchedRide[]
 *
 * Matching is deliberately NOT discovery (it does not query the database and
 * never re-runs the PostGIS query) and NOT request creation. It is pure
 * computation over the candidates handed to it, so it is fully unit-testable
 * without PostgreSQL, Prisma, or HTTP.
 *
 * Thresholds are supplied as `MatchingConfiguration` (domain input) and are
 * server-controlled product policy (OD-004 — resolved Phase 3.19): the
 * production HTTP path builds them from centralized config and never accepts
 * them from callers. `maxResults` (when provided) is the server-owned result
 * cap (default 20); callers cannot override it.
 */
import { ValidationError } from '../../../lib/errors.js';
import { isValidLatitude, isValidLongitude } from '../domain/ride-rules.js';
import { evaluateCandidateMatch } from '../domain/matching/evaluate.js';
import { rankMatches } from '../domain/matching/rank.js';
import type { CandidateMatchResult } from '../domain/matching/types.js';
import type { FactorResult } from '../domain/matching/types.js';
import type { MatchCandidate } from '../domain/matching/types.js';
import type { MatchingConfiguration } from '../domain/matching/types.js';
import type { RideMatchingInput } from '../domain/matching/types.js';
import type { DiscoveredRide } from './discover-rides.js';

/**
 * The matching result for one candidate. Preserves the full discovered
 * candidate for future RideRequest/UI layers (Phase 3.4 §14) plus the
 * eligibility decision and the structured, explainable factor results.
 */
export interface MatchedRide {
  ride: DiscoveredRide;
  eligible: boolean;
  factors: FactorResult[];
}

/** An evaluated candidate paired with its discovered ride. */
interface EvaluatedRide {
  ride: DiscoveredRide;
  candidate: MatchCandidate;
  result: CandidateMatchResult;
}

/**
 * Application-level input checks for matching. Coordinate bounds reuse the
 * Phase 3.1 domain predicates; time/seat/count and threshold checks are
 * input-shape checks the application layer owns.
 */
function assertValidMatchingInput(input: RideMatchingInput): void {
  if (!isValidLatitude(input.destination.latitude)) {
    throw new ValidationError(
      'destination latitude must be a finite number between -90 and 90',
      {
        field: 'destination.latitude',
        details: { latitude: input.destination.latitude },
      },
    );
  }
  if (!isValidLongitude(input.destination.longitude)) {
    throw new ValidationError(
      'destination longitude must be a finite number between -180 and 180',
      {
        field: 'destination.longitude',
        details: { longitude: input.destination.longitude },
      },
    );
  }
  if (
    !(input.preferredDepartureTime instanceof Date) ||
    Number.isNaN(input.preferredDepartureTime.getTime())
  ) {
    throw new ValidationError('preferredDepartureTime must be a valid date', {
      field: 'preferredDepartureTime',
    });
  }
  if (
    input.requestedSeats !== undefined &&
    (!Number.isInteger(input.requestedSeats) || input.requestedSeats <= 0)
  ) {
    throw new ValidationError('requestedSeats must be a positive integer', {
      field: 'requestedSeats',
      details: { requestedSeats: input.requestedSeats },
    });
  }
}

/**
 * Validates the OD-004 thresholds. They are supplied as domain input (built
 * by the application from server config) and must be well-formed for the
 * factors to be meaningful; the values themselves are never chosen here.
 */
function assertValidMatchingConfig(config: MatchingConfiguration): void {
  if (
    !Number.isFinite(config.pickupRadiusMeters) ||
    config.pickupRadiusMeters <= 0
  ) {
    throw new ValidationError(
      'pickupRadiusMeters must be a finite positive number',
      {
        field: 'pickupRadiusMeters',
        details: { pickupRadiusMeters: config.pickupRadiusMeters },
      },
    );
  }
  if (
    !Number.isFinite(config.departureTimeWindowMinutes) ||
    config.departureTimeWindowMinutes <= 0
  ) {
    throw new ValidationError(
      'departureTimeWindowMinutes must be a finite positive number',
      {
        field: 'departureTimeWindowMinutes',
        details: {
          departureTimeWindowMinutes: config.departureTimeWindowMinutes,
        },
      },
    );
  }
  if (
    !Number.isFinite(config.destinationToleranceMeters) ||
    config.destinationToleranceMeters < 0
  ) {
    throw new ValidationError(
      'destinationToleranceMeters must be a finite non-negative number',
      {
        field: 'destinationToleranceMeters',
        details: {
          destinationToleranceMeters: config.destinationToleranceMeters,
        },
      },
    );
  }
}

/** Maps a discovered ride to the domain candidate shape. */
function toMatchCandidate(ride: DiscoveredRide): MatchCandidate {
  return {
    id: ride.id,
    status: ride.status,
    departureDateTime: ride.departureDateTime,
    availableSeats: ride.availableSeats,
    pickupDistanceMeters: ride.distanceMeters,
    destination: {
      latitude: ride.destinationLocation.latitude,
      longitude: ride.destinationLocation.longitude,
    },
  };
}

/**
 * Evaluates and ranks discovered candidates for the participant's requested
 * journey.
 *
 * Returns one `MatchedRide` per candidate (including ineligible ones, each
 * with structured factor reasons so a future UI can explain weak matches),
 * ranked by the documented relevance signals. When `maxResults` is provided
 * the result is capped at that count (server-owned limit — OD-004); the cap
 * is applied AFTER ranking so the top-ranked candidates are always returned.
 *
 * Synchronous and side-effect free: no database access, no external calls,
 * no writes. Throws `ValidationError` for malformed input or configuration.
 */
export function matchRides(
  input: RideMatchingInput,
  candidates: readonly DiscoveredRide[],
  config: MatchingConfiguration,
  maxResults?: number,
): MatchedRide[] {
  assertValidMatchingInput(input);
  assertValidMatchingConfig(config);
  if (maxResults !== undefined) {
    if (!Number.isInteger(maxResults) || maxResults <= 0) {
      throw new ValidationError('maxResults must be a positive integer', {
        field: 'maxResults',
        details: { maxResults },
      });
    }
  }

  const evaluated: EvaluatedRide[] = candidates.map((ride) => {
    const candidate = toMatchCandidate(ride);
    return {
      ride,
      candidate,
      result: evaluateCandidateMatch(input, candidate, config),
    };
  });

  const ranked = rankMatches(evaluated, input.preferredDepartureTime);

  const limited =
    maxResults === undefined ? ranked : ranked.slice(0, maxResults);

  return limited.map(({ ride, result }) => ({
    ride,
    eligible: result.eligible,
    factors: result.factors,
  }));
}

// Canonical input/config types for callers and tests.
export type {
  MatchingConfiguration,
  RideMatchingInput,
} from '../domain/matching/types.js';
