/**
 * Candidate evaluation (Phase 3.4 — matching decision).
 *
 * Evaluates one candidate against all five documented factors
 * (`docs/domain/matching-model.md` §4) and applies the documented decision:
 * a ride is eligible only when ALL five conditions are ANDed (§9).
 *
 * Pure function — no I/O, no mutation, no logging. Fully unit-testable.
 */
import { evaluateDestinationCompatibility } from './factors/destination-compatibility.js';
import { evaluatePickupProximity } from './factors/pickup-proximity.js';
import { evaluateRideStatus } from './factors/ride-status.js';
import { evaluateSeatAvailability } from './factors/seat-availability.js';
import { evaluateTimeCompatibility } from './factors/time-compatibility.js';
import type { CandidateMatchResult } from './types.js';
import type { FactorResult } from './types.js';
import type { MatchCandidate } from './types.js';
import type { MatchingConfiguration } from './types.js';
import type { RideMatchingInput } from './types.js';

/** Default requested seat count when the participant does not specify one. */
export const DEFAULT_REQUESTED_SEATS = 1;

/**
 * Evaluates a single candidate against the participant's request and the
 * matching configuration.
 *
 * Returns every factor result (in documented priority order) plus the ANDed
 * eligibility decision, so callers get both the decision and the structured
 * explanation.
 */
export function evaluateCandidateMatch(
  input: RideMatchingInput,
  candidate: MatchCandidate,
  config: MatchingConfiguration,
): CandidateMatchResult {
  const requestedSeats = input.requestedSeats ?? DEFAULT_REQUESTED_SEATS;

  const factors: FactorResult[] = [
    evaluatePickupProximity(candidate, config),
    evaluateDestinationCompatibility(input.destination, candidate, config),
    evaluateTimeCompatibility(
      input.preferredDepartureTime,
      candidate.departureDateTime,
      config,
    ),
    evaluateSeatAvailability(candidate, requestedSeats),
    evaluateRideStatus(candidate),
  ];

  return {
    candidateId: candidate.id,
    eligible: factors.every((factor) => factor.eligible),
    factors,
  };
}
