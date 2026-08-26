/**
 * Matching configuration (OD-004 — resolved Phase 3.19).
 *
 * Builds the domain `MatchingConfiguration` from the centralized server
 * configuration so the approved V1 thresholds (5 km pickup radius, ±60 min
 * departure window, 5 km destination tolerance) and the 20-result cap are
 * server-controlled product policy. HTTP callers can never supply these
 * values — they only provide the participant's journey input.
 */
import type { MatchingConfiguration } from '../domain/matching/types.js';

/** Server-controlled matching policy values (OD-004, Phase 3.19). */
export interface MatchingPolicyConfig {
  MATCHING_PICKUP_RADIUS_METERS: number;
  MATCHING_DEPARTURE_WINDOW_MINUTES: number;
  MATCHING_DESTINATION_TOLERANCE_METERS: number;
  MATCHING_MAX_RESULTS: number;
}

/**
 * Maps the validated server config into the domain matching configuration.
 * Units are preserved exactly (meters / minutes); the domain never chooses a
 * value.
 */
export function matchingConfigurationFromConfig(
  config: MatchingPolicyConfig,
): MatchingConfiguration {
  return {
    pickupRadiusMeters: config.MATCHING_PICKUP_RADIUS_METERS,
    departureTimeWindowMinutes: config.MATCHING_DEPARTURE_WINDOW_MINUTES,
    destinationToleranceMeters: config.MATCHING_DESTINATION_TOLERANCE_METERS,
  };
}

/** The server-owned maximum number of matching results (OD-004). */
export function matchingMaxResultsFromConfig(
  config: Pick<MatchingPolicyConfig, 'MATCHING_MAX_RESULTS'>,
): number {
  return config.MATCHING_MAX_RESULTS;
}
