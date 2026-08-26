/**
 * Ride status factor (Phase 3.4 — matching factor 5).
 *
 * `docs/domain/matching-model.md` §4: "ride is active (`PUBLISHED` /
 * `CONFIRMED` with seats)". Status is evaluated from the candidate's carried
 * `status`; the "with seats" half of the definition is the separate seat
 * availability factor (factor 4), which reads `availableSeats`.
 *
 * Discovery already guarantees discoverable statuses, so this factor is
 * normally satisfied for discovered candidates — it is still evaluated so
 * matching remains complete and independent of the candidate source (unit
 * tests can pass any candidate).
 */
import { RideStatus } from '@prisma/client';
import { MATCH_FACTOR_IDS } from '../types.js';
import type { FactorResult } from '../types.js';
import type { MatchCandidate } from '../types.js';

export function evaluateRideStatus(
  candidate: Pick<MatchCandidate, 'status'>,
): FactorResult {
  const active =
    candidate.status === RideStatus.PUBLISHED ||
    candidate.status === RideStatus.CONFIRMED;

  return {
    factor: MATCH_FACTOR_IDS.RIDE_STATUS,
    eligible: active,
    value: candidate.status,
    reason: active
      ? `ride status is ${candidate.status}, which is active`
      : `ride status is ${candidate.status}, which is not active`,
  };
}
