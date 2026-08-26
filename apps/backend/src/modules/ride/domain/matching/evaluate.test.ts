/**
 * Unit tests for candidate evaluation (Phase 3.4 — eligibility decision).
 *
 * Verifies the documented decision model (`docs/domain/matching-model.md`):
 * a candidate is eligible only when ALL five factors pass (§9 — conditions
 * are ANDed), factor results are returned in documented priority order, and
 * the requested seat count is applied.
 */
import { describe, expect, it } from 'vitest';
import { RideStatus } from '@prisma/client';
import { evaluateCandidateMatch } from './evaluate.js';
import { MATCH_FACTOR_IDS } from './types.js';
import type { MatchingConfiguration } from './types.js';
import type { RideMatchingInput } from './types.js';
import type { MatchCandidate } from './types.js';

const config: MatchingConfiguration = {
  pickupRadiusMeters: 5000,
  departureTimeWindowMinutes: 60,
  destinationToleranceMeters: 5000,
};

const input: RideMatchingInput = {
  destination: { latitude: 12.2958, longitude: 76.6394 },
  preferredDepartureTime: new Date('2026-08-20T10:00:00.000Z'),
};

const candidate: MatchCandidate = {
  id: 'ride-1',
  status: RideStatus.PUBLISHED,
  departureDateTime: new Date('2026-08-20T10:00:00.000Z'),
  availableSeats: 3,
  pickupDistanceMeters: 800,
  destination: { latitude: 12.2958, longitude: 76.6394 },
};

describe('evaluateCandidateMatch — eligibility decision', () => {
  it('is eligible when all five factors pass (ANDed)', () => {
    const result = evaluateCandidateMatch(input, candidate, config);
    expect(result.candidateId).toBe('ride-1');
    expect(result.eligible).toBe(true);
    expect(result.factors.every((factor) => factor.eligible)).toBe(true);
  });

  it('fails when the pickup is beyond the configured radius (factor 1)', () => {
    const result = evaluateCandidateMatch(
      input,
      { ...candidate, pickupDistanceMeters: 9000 },
      config,
    );
    expect(result.eligible).toBe(false);
    expect(result.factors[0]).toMatchObject({
      factor: MATCH_FACTOR_IDS.PICKUP_PROXIMITY,
      eligible: false,
    });
  });

  it('fails when the destination is incompatible (factor 2)', () => {
    const result = evaluateCandidateMatch(
      input,
      { ...candidate, destination: { latitude: 15.5, longitude: 76.6394 } },
      config,
    );
    expect(result.eligible).toBe(false);
    expect(result.factors[1]).toMatchObject({
      factor: MATCH_FACTOR_IDS.DESTINATION_COMPATIBILITY,
      eligible: false,
    });
  });

  it('fails when the departure time is outside the window (factor 3)', () => {
    const result = evaluateCandidateMatch(
      input,
      { ...candidate, departureDateTime: new Date('2026-08-20T16:00:00.000Z') },
      config,
    );
    expect(result.eligible).toBe(false);
    expect(result.factors[2]).toMatchObject({
      factor: MATCH_FACTOR_IDS.TIME_COMPATIBILITY,
      eligible: false,
    });
  });

  it('fails when seats are insufficient for the requested count (factor 4)', () => {
    const result = evaluateCandidateMatch(
      { ...input, requestedSeats: 2 },
      { ...candidate, availableSeats: 1 },
      config,
    );
    expect(result.eligible).toBe(false);
    expect(result.factors[3]).toMatchObject({
      factor: MATCH_FACTOR_IDS.SEAT_AVAILABILITY,
      eligible: false,
    });
  });

  it('fails when the ride status is not active (factor 5)', () => {
    const result = evaluateCandidateMatch(
      input,
      { ...candidate, status: RideStatus.DRAFT },
      config,
    );
    expect(result.eligible).toBe(false);
    expect(result.factors[4]).toMatchObject({
      factor: MATCH_FACTOR_IDS.RIDE_STATUS,
      eligible: false,
    });
  });

  it('returns factors in the documented priority order', () => {
    const result = evaluateCandidateMatch(input, candidate, config);
    expect(result.factors.map((factor) => factor.factor)).toEqual([
      MATCH_FACTOR_IDS.PICKUP_PROXIMITY,
      MATCH_FACTOR_IDS.DESTINATION_COMPATIBILITY,
      MATCH_FACTOR_IDS.TIME_COMPATIBILITY,
      MATCH_FACTOR_IDS.SEAT_AVAILABILITY,
      MATCH_FACTOR_IDS.RIDE_STATUS,
    ]);
  });

  it('contains only the five documented factors', () => {
    const result = evaluateCandidateMatch(input, candidate, config);
    const documented = new Set(Object.values(MATCH_FACTOR_IDS));
    expect(
      result.factors.every((factor) => documented.has(factor.factor)),
    ).toBe(true);
    expect(result.factors).toHaveLength(5);
  });
});

describe('evaluateCandidateMatch — requested seats', () => {
  it('defaults to a single requested seat', () => {
    const result = evaluateCandidateMatch(input, candidate, config);
    expect(result.factors[3]).toMatchObject({
      factor: MATCH_FACTOR_IDS.SEAT_AVAILABILITY,
      threshold: 1,
      eligible: true,
    });
  });

  it('applies the requested seat count to the seat factor', () => {
    const result = evaluateCandidateMatch(
      { ...input, requestedSeats: 2 },
      { ...candidate, availableSeats: 2 },
      config,
    );
    expect(result.factors[3]).toMatchObject({
      threshold: 2,
      eligible: true,
    });
  });

  it('fails when the requested seat count exceeds availability', () => {
    const result = evaluateCandidateMatch(
      { ...input, requestedSeats: 4 },
      candidate,
      config,
    );
    expect(result.factors[3]).toMatchObject({
      factor: MATCH_FACTOR_IDS.SEAT_AVAILABILITY,
      eligible: false,
    });
    expect(result.eligible).toBe(false);
  });
});
