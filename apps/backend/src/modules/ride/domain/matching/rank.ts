/**
 * Deterministic relevance ranking (Phase 3.4 — matching ranking).
 *
 * `docs/domain/matching-model.md` §5 defines the sort signals: "Closer
 * pickup → higher rank. Departure time closer to participant preference →
 * higher rank." No numeric score exists (OD-004 — resolved Phase 3.19 — V1
 * uses no relevance score), so ranking is a deterministic lexicographic sort:
 *
 *   1. pickup distance ASC (primary)
 *   2. departure-time proximity to the participant's preference ASC
 *   3. candidate id ASC (explicit tie-break — never relies on database row
 *      order or random ordering)
 *
 * This is a faithful reading of §5: pickup proximity is the model's factor
 * of highest priority (§4) and is listed first. It is NOT a match score and
 * is independent of eligibility.
 *
 * Pure and deterministic: identical inputs always produce identical output,
 * and the output does not depend on the input array's order.
 */
import type { MatchCandidate } from './types.js';
import type { CandidateMatchResult } from './types.js';

/** An evaluated candidate paired with its match result. */
export interface MatchedCandidate {
  candidate: MatchCandidate;
  result: CandidateMatchResult;
}

/** The deterministic sort key derived from a candidate (§5). */
export interface MatchSortKey {
  pickupDistanceMeters: number;
  /** Absolute minutes between the ride departure and the participant's preference. */
  timeProximityMinutes: number;
  candidateId: string;
}

/** Builds the sort key for a candidate against the participant's preference. */
export function matchSortKey(
  candidate: MatchCandidate,
  preferredDepartureTime: Date,
): MatchSortKey {
  return {
    pickupDistanceMeters: candidate.pickupDistanceMeters,
    timeProximityMinutes:
      Math.abs(
        candidate.departureDateTime.getTime() -
          preferredDepartureTime.getTime(),
      ) / 60_000,
    candidateId: candidate.id,
  };
}

/** Compares two sort keys (ascending pickup, then time proximity, then id). */
export function compareMatchSortKeys(a: MatchSortKey, b: MatchSortKey): number {
  if (a.pickupDistanceMeters !== b.pickupDistanceMeters) {
    return a.pickupDistanceMeters - b.pickupDistanceMeters;
  }
  if (a.timeProximityMinutes !== b.timeProximityMinutes) {
    return a.timeProximityMinutes - b.timeProximityMinutes;
  }
  return a.candidateId.localeCompare(b.candidateId);
}

/**
 * Returns a new array of entries sorted by the documented relevance signals.
 * The input array is not mutated. Any entry carrying a `candidate` field is
 * supported, so callers can rank enriched entries (e.g. candidates paired
 * with their discovered ride) without data loss.
 */
export function rankMatches<T extends { candidate: MatchCandidate }>(
  entries: readonly T[],
  preferredDepartureTime: Date,
): T[] {
  return [...entries].sort((a, b) =>
    compareMatchSortKeys(
      matchSortKey(a.candidate, preferredDepartureTime),
      matchSortKey(b.candidate, preferredDepartureTime),
    ),
  );
}
