/**
 * Time compatibility factor (Phase 3.4 — matching factor 3).
 *
 * `docs/domain/matching-model.md` §4: "departure within an acceptable
 * window". The participant's preferred departure time and the ride's
 * departure time are compared as absolute millisecond instants (both are
 * UTC-based `Date`s), so the ± window is timezone-agnostic — no UTC/local
 * assumption is made.
 *
 * The window is server-controlled product policy (OD-004 — resolved Phase
 * 3.19, approved ±60 min) and comes from `MatchingConfiguration`.
 */
import { MATCH_FACTOR_IDS } from '../types.js';
import type { FactorResult } from '../types.js';
import type { MatchingConfiguration } from '../types.js';

export function evaluateTimeCompatibility(
  preferredDepartureTime: Date,
  rideDepartureTime: Date,
  config: MatchingConfiguration,
): FactorResult {
  const minutesAway =
    Math.abs(preferredDepartureTime.getTime() - rideDepartureTime.getTime()) /
    60_000;
  // Inclusive at the boundary (exactly at the window edge is acceptable).
  const withinWindow = minutesAway <= config.departureTimeWindowMinutes;

  return {
    factor: MATCH_FACTOR_IDS.TIME_COMPATIBILITY,
    eligible: withinWindow,
    value: minutesAway,
    threshold: config.departureTimeWindowMinutes,
    reason: withinWindow
      ? `departure is ${Math.round(minutesAway)}min from the preferred time, within the ±${config.departureTimeWindowMinutes}min window`
      : `departure is ${Math.round(minutesAway)}min from the preferred time, outside the ±${config.departureTimeWindowMinutes}min window`,
  };
}
