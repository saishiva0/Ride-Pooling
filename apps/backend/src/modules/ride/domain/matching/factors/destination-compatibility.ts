/**
 * Destination compatibility factor (Phase 3.4 — matching factor 2).
 *
 * `docs/domain/matching-model.md` §4: "participant's destination compatible
 * with ride destination". Implements the documented straight-line approach
 * (§7 "straight-line fallback"): the participant's destination must be within
 * the configured tolerance of the ride destination.
 *
 * The tolerance is server-controlled product policy (OD-004 — resolved Phase
 * 3.19, approved 5,000 m); the "on-route / detour" alternative would require
 * the routing provider decision (OD-007) and is intentionally not
 * implemented. Distance uses the pure great-circle function in
 * `../distance.ts`.
 */
import { greatCircleDistanceMeters } from '../distance.js';
import { MATCH_FACTOR_IDS } from '../types.js';
import type { FactorResult } from '../types.js';
import type { MatchCandidate } from '../types.js';
import type { MatchingConfiguration } from '../types.js';
import type { RideCoordinates } from '../../ride.types.js';

export function evaluateDestinationCompatibility(
  participantDestination: RideCoordinates,
  candidate: MatchCandidate,
  config: MatchingConfiguration,
): FactorResult {
  const distance = greatCircleDistanceMeters(
    participantDestination,
    candidate.destination,
  );
  // Inclusive at the boundary.
  const withinTolerance = distance <= config.destinationToleranceMeters;

  return {
    factor: MATCH_FACTOR_IDS.DESTINATION_COMPATIBILITY,
    eligible: withinTolerance,
    value: distance,
    threshold: config.destinationToleranceMeters,
    reason: withinTolerance
      ? `destination is ${Math.round(distance)}m from the ride destination, within the ${config.destinationToleranceMeters}m tolerance`
      : `destination is ${Math.round(distance)}m from the ride destination, beyond the ${config.destinationToleranceMeters}m tolerance`,
  };
}
