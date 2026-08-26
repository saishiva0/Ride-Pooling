/**
 * Unit tests for deterministic relevance ranking (Phase 3.4).
 *
 * Verifies the documented sort signals (`docs/domain/matching-model.md` §5):
 * closer pickup ranks higher, then departure closer to the preference, then
 * an explicit candidate-id tie-break — plus determinism and
 * input-order independence.
 */
import { describe, expect, it } from 'vitest';
import { RideStatus } from '@prisma/client';
import { rankMatches } from './rank.js';
import type { MatchedCandidate } from './rank.js';
import type { MatchCandidate } from './types.js';

const PREFERRED = new Date('2026-08-20T10:00:00.000Z');

function candidate(
  id: string,
  pickupDistanceMeters: number,
  departureOffsetMinutes: number,
): MatchCandidate {
  return {
    id,
    status: RideStatus.PUBLISHED,
    departureDateTime: new Date(
      PREFERRED.getTime() + departureOffsetMinutes * 60_000,
    ),
    availableSeats: 3,
    pickupDistanceMeters,
    destination: { latitude: 12.2958, longitude: 76.6394 },
  };
}

function entry(cand: MatchCandidate, eligible = true): MatchedCandidate {
  return {
    candidate: cand,
    result: { candidateId: cand.id, eligible, factors: [] },
  };
}

function ids(entries: { candidate: MatchCandidate }[]): string[] {
  return entries.map((e) => e.candidate.id);
}

describe('rankMatches — documented sort signals', () => {
  it('ranks closer pickups first', () => {
    const entries = [
      entry(candidate('far', 5000, 10)),
      entry(candidate('mid', 3000, 10)),
      entry(candidate('near', 100, 10)),
    ];
    expect(ids(rankMatches(entries, PREFERRED))).toEqual([
      'near',
      'mid',
      'far',
    ]);
  });

  it('breaks pickup-distance ties by departure-time proximity to the preference', () => {
    const entries = [
      entry(candidate('late', 1000, 50)),
      entry(candidate('exact', 1000, 0)),
      entry(candidate('early', 1000, 45)),
    ];
    expect(ids(rankMatches(entries, PREFERRED))).toEqual([
      'exact',
      'early',
      'late',
    ]);
  });

  it('breaks full ties by candidate id (stable, deterministic)', () => {
    const entries = [
      entry(candidate('b-ride', 1000, 10)),
      entry(candidate('a-ride', 1000, 10)),
      entry(candidate('c-ride', 1000, 10)),
    ];
    expect(ids(rankMatches(entries, PREFERRED))).toEqual([
      'a-ride',
      'b-ride',
      'c-ride',
    ]);
  });

  it('does not mutate the input array', () => {
    const entries = [
      entry(candidate('b', 1000, 10)),
      entry(candidate('a', 100, 10)),
    ];
    const before = ids(entries);
    rankMatches(entries, PREFERRED);
    expect(ids(entries)).toEqual(before);
  });
});

describe('rankMatches — determinism and edge cases', () => {
  it('produces identical output across repeated executions', () => {
    const entries = [
      entry(candidate('x', 5000, 10)),
      entry(candidate('y', 100, 20)),
      entry(candidate('z', 100, 5)),
      entry(candidate('w', 100, 5)),
    ];
    const first = rankMatches(entries, PREFERRED);
    const second = rankMatches(entries, PREFERRED);
    const third = rankMatches(entries, PREFERRED);
    expect(ids(first)).toEqual(ids(second));
    expect(ids(second)).toEqual(ids(third));
  });

  it('produces the same output regardless of input order', () => {
    const shuffled = [
      entry(candidate('z', 7000, 5)),
      entry(candidate('a', 200, 5)),
      entry(candidate('m', 200, 40)),
      entry(candidate('n', 200, 40)),
    ];
    const reversed = [...shuffled].reverse();
    const fromShuffled = rankMatches(shuffled, PREFERRED);
    const fromReversed = rankMatches(reversed, PREFERRED);
    expect(ids(fromShuffled)).toEqual(ids(fromReversed));
  });

  it('returns an empty array for zero candidates', () => {
    expect(rankMatches([], PREFERRED)).toEqual([]);
  });

  it('returns a single candidate unchanged', () => {
    const entries = [entry(candidate('only', 1000, 0))];
    expect(ids(rankMatches(entries, PREFERRED))).toEqual(['only']);
  });
});
