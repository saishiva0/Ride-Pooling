/**
 * Pickup proximity factor (Phase 3.4 — matching factor 1).
 *
 * `docs/domain/matching-model.md` §4: "participant within configured pickup
 * radius of ride pickup". Reuses the pickup-to-pickup distance discovery
 * already computed (`MatchCandidate.pickupDistanceMeters`); it is never
 * recomputed here.
 *
 * The radius is server-controlled product policy (OD-004 — resolved Phase
 * 3.19, approved 5,000 m) and comes from `MatchingConfiguration` — this
 * function never chooses it.
 */
import type { MatchingConfiguration } from '../types.js';
import { MATCH_FACTOR_IDS } from '../types.js';
import type { FactorResult } from '../types.js';
import type { MatchCandidate } from '../types.js';

export function evaluatePickupProximity(
  candidate: Pick<MatchCandidate, 'pickupDistanceMeters'>,
  config: MatchingConfiguration,
): FactorResult {
  // Inclusive at the boundary, matching the PostGIS discovery semantics
  // (ST_DWithin(geography, …, radius) returns distance == radius).
  const withinRadius =
    candidate.pickupDistanceMeters <= config.pickupRadiusMeters;

  return {
    factor: MATCH_FACTOR_IDS.PICKUP_PROXIMITY,
    eligible: withinRadius,
    value: candidate.pickupDistanceMeters,
    threshold: config.pickupRadiusMeters,
    reason: withinRadius
      ? `pickup is ${Math.round(candidate.pickupDistanceMeters)}m away, within the ${config.pickupRadiusMeters}m radius`
      : `pickup is ${Math.round(candidate.pickupDistanceMeters)}m away, beyond the ${config.pickupRadiusMeters}m radius`,
  };
}
