/**
 * Seat availability factor (Phase 3.4 — matching factor 4).
 *
 * `docs/domain/matching-model.md` §4: "ride has available capacity".
 * Reuses the candidate's `availableSeats` value as computed by discovery
 * (total seats − confirmed participants); matching does not modify seat
 * counts, reserve seats, or create participants (Phase 3.4 §20).
 *
 * Passes when `availableSeats >= requestedSeats` (inclusive at equality).
 * `requestedSeats` defaults to 1 (matching-model.md §3 — "or requested
 * count").
 */
import { MATCH_FACTOR_IDS } from '../types.js';
import type { FactorResult } from '../types.js';
import type { MatchCandidate } from '../types.js';

export function evaluateSeatAvailability(
  candidate: Pick<MatchCandidate, 'availableSeats'>,
  requestedSeats: number,
): FactorResult {
  const hasCapacity = candidate.availableSeats >= requestedSeats;

  return {
    factor: MATCH_FACTOR_IDS.SEAT_AVAILABILITY,
    eligible: hasCapacity,
    value: candidate.availableSeats,
    threshold: requestedSeats,
    reason: hasCapacity
      ? `${candidate.availableSeats} seat(s) available, enough for ${requestedSeats} requested`
      : `${candidate.availableSeats} seat(s) available, not enough for ${requestedSeats} requested`,
  };
}
