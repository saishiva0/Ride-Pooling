/**
 * Unit tests for the Phase 3.4 ride matching use case.
 *
 * No PostgreSQL required — matching is pure computation over discovered
 * candidates. Covers input/config validation, candidate mapping (no raw
 * Prisma types), eligibility, ranking, tie-breaking, and determinism.
 */
import { describe, expect, it } from 'vitest';
import { PricingType, RideStatus } from '@prisma/client';
import { matchRides } from './match-rides.js';
import type { DiscoveredRide } from './discover-rides.js';
import { MATCH_FACTOR_IDS } from '../domain/matching/types.js';

function discoveredRide(
  overrides: Partial<DiscoveredRide> = {},
): DiscoveredRide {
  return {
    id: 'ride-1',
    creator: { id: 'user-1', name: 'Riya' },
    pickupLocation: {
      id: 'loc-pickup',
      latitude: 12.9716,
      longitude: 77.5946,
      label: 'Pickup',
    },
    destinationLocation: {
      id: 'loc-destination',
      latitude: 12.2958,
      longitude: 76.6394,
      label: 'Destination',
    },
    departureDateTime: new Date('2026-08-20T10:00:00.000Z'),
    totalSeats: 4,
    availableSeats: 3,
    pricingType: PricingType.STANDARD,
    pricePerKm: 4,
    distanceMeters: 800,
    status: RideStatus.PUBLISHED,
    ...overrides,
  };
}

const input = {
  destination: { latitude: 12.2958, longitude: 76.6394 },
  preferredDepartureTime: new Date('2026-08-20T10:00:00.000Z'),
};

const config = {
  pickupRadiusMeters: 5000,
  departureTimeWindowMinutes: 60,
  destinationToleranceMeters: 5000,
};

describe('matchRides — evaluation and result shape', () => {
  it('returns one MatchedRide per candidate with the documented shape', () => {
    const results = matchRides(input, [discoveredRide()], config);

    expect(results).toHaveLength(1);
    const matched = results[0];
    expect(matched.ride).toEqual(discoveredRide());
    expect(matched.eligible).toBe(true);
    expect(matched.factors.map((f) => f.factor)).toEqual(
      Object.values(MATCH_FACTOR_IDS),
    );
  });

  it('does not leak raw Prisma types into the result', () => {
    const [matched] = matchRides(input, [discoveredRide()], config);
    expect(matched.ride.pricePerKm).toBe(4);
    expect(typeof matched.ride.pricePerKm).toBe('number');
    expect(matched.ride.distanceMeters).toBe(800);
    expect(matched.ride.status).toBe(RideStatus.PUBLISHED);
    expect(matched.ride.pickupLocation.latitude).toBe(12.9716);
    expect(matched.factors[0]).toMatchObject({
      factor: MATCH_FACTOR_IDS.PICKUP_PROXIMITY,
      value: 800,
      threshold: 5000,
    });
  });

  it('marks a candidate ineligible when a factor fails, with the failing factor explained', () => {
    const tooFar = discoveredRide({ id: 'far', distanceMeters: 9000 });
    const [matched] = matchRides(input, [tooFar], config);

    expect(matched.eligible).toBe(false);
    expect(matched.factors[0]).toMatchObject({
      factor: MATCH_FACTOR_IDS.PICKUP_PROXIMITY,
      eligible: false,
    });
    expect(matched.factors[0].reason).toContain('9000m');
  });

  it('uses the candidate status for the ride-status factor', () => {
    const draft = discoveredRide({ status: RideStatus.DRAFT });
    const [matched] = matchRides(input, [draft], config);
    expect(matched.factors[4]).toMatchObject({
      factor: MATCH_FACTOR_IDS.RIDE_STATUS,
      eligible: false,
    });
  });

  it('returns no results for zero candidates', () => {
    expect(matchRides(input, [], config)).toEqual([]);
  });
});

describe('matchRides — ranking', () => {
  it('ranks multiple candidates by pickup distance then time proximity', () => {
    const near = discoveredRide({ id: 'near', distanceMeters: 100 });
    const far = discoveredRide({ id: 'far', distanceMeters: 4000 });
    const sameDistanceLate = discoveredRide({
      id: 'same-distance-late',
      distanceMeters: 100,
      departureDateTime: new Date('2026-08-20T11:00:00.000Z'),
    });

    const results = matchRides(input, [far, sameDistanceLate, near], config);

    expect(results.map((r) => r.ride.id)).toEqual([
      'near',
      'same-distance-late',
      'far',
    ]);
  });

  it('ties are broken deterministically by candidate id', () => {
    const a = discoveredRide({ id: 'ride-b', distanceMeters: 100 });
    const b = discoveredRide({ id: 'ride-a', distanceMeters: 100 });

    const results = matchRides(input, [a, b], config);
    expect(results.map((r) => r.ride.id)).toEqual(['ride-a', 'ride-b']);
  });
});

describe('matchRides — determinism', () => {
  it('produces identical output across repeated executions for identical input', () => {
    const candidates = [
      discoveredRide({ id: 'ride-b', distanceMeters: 300 }),
      discoveredRide({ id: 'ride-a', distanceMeters: 300, availableSeats: 1 }),
      discoveredRide({ id: 'ride-c', distanceMeters: 50 }),
    ];
    const first = matchRides(input, candidates, config);
    const second = matchRides(input, candidates, config);
    const third = matchRides(input, candidates, config);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
  });

  it('produces the same output regardless of candidate input order', () => {
    const candidates = [
      discoveredRide({ id: 'ride-b', distanceMeters: 300 }),
      discoveredRide({ id: 'ride-a', distanceMeters: 300 }),
      discoveredRide({ id: 'ride-c', distanceMeters: 50 }),
    ];
    const reversed = [...candidates].reverse();
    expect(matchRides(input, candidates, config)).toEqual(
      matchRides(input, reversed, config),
    );
  });
});

describe('matchRides — input validation', () => {
  it('rejects an out-of-range destination latitude', () => {
    expect(() =>
      matchRides(
        { ...input, destination: { latitude: 91, longitude: 77 } },
        [discoveredRide()],
        config,
      ),
    ).toThrow(/destination latitude/);
  });

  it('rejects an invalid preferredDepartureTime', () => {
    expect(() =>
      matchRides(
        { ...input, preferredDepartureTime: new Date('nope') },
        [discoveredRide()],
        config,
      ),
    ).toThrow(/preferredDepartureTime/);
  });

  it('rejects a non-positive or non-integer requestedSeats', () => {
    for (const requestedSeats of [0, -2, 2.5]) {
      expect(() =>
        matchRides({ ...input, requestedSeats }, [discoveredRide()], config),
      ).toThrow(/requestedSeats/);
    }
  });
});

describe('matchRides — configuration validation', () => {
  it('rejects a zero or negative pickup radius', () => {
    for (const pickupRadiusMeters of [0, -1]) {
      expect(() =>
        matchRides(input, [discoveredRide()], {
          ...config,
          pickupRadiusMeters,
        }),
      ).toThrow(/pickupRadiusMeters/);
    }
  });

  it('rejects a non-finite departure time window', () => {
    expect(() =>
      matchRides(input, [discoveredRide()], {
        ...config,
        departureTimeWindowMinutes: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(/departureTimeWindowMinutes/);
  });

  it('rejects a negative destination tolerance', () => {
    expect(() =>
      matchRides(input, [discoveredRide()], {
        ...config,
        destinationToleranceMeters: -1,
      }),
    ).toThrow(/destinationToleranceMeters/);
  });
});

describe('matchRides — approved OD-004 thresholds (Phase 3.19)', () => {
  const approvedConfig = {
    pickupRadiusMeters: 5000,
    departureTimeWindowMinutes: 60,
    destinationToleranceMeters: 5000,
  };

  it('accepts exactly at each threshold boundary (inclusive)', () => {
    const atPickupAndTimeBoundary = discoveredRide({
      distanceMeters: 5000,
      departureDateTime: new Date('2026-08-20T11:00:00.000Z'),
    });
    // Destination ~0.5 km from the ride destination (same fixture as the
    // destination-compatibility factor boundary tests).
    const withinDestinationTolerance = discoveredRide({
      destinationLocation: {
        id: 'loc-destination-near',
        latitude: 12.3005,
        longitude: 76.6394,
        label: 'near destination',
      },
    });

    const [pickupTimeBoundary] = matchRides(
      input,
      [atPickupAndTimeBoundary],
      approvedConfig,
    );
    expect(pickupTimeBoundary.factors[0]).toMatchObject({
      factor: MATCH_FACTOR_IDS.PICKUP_PROXIMITY,
      eligible: true,
      value: 5000,
      threshold: 5000,
    });
    expect(pickupTimeBoundary.factors[2]).toMatchObject({
      factor: MATCH_FACTOR_IDS.TIME_COMPATIBILITY,
      eligible: true,
      value: 60,
      threshold: 60,
    });

    const [destinationBoundary] = matchRides(
      input,
      [withinDestinationTolerance],
      approvedConfig,
    );
    expect(destinationBoundary.factors[1]).toMatchObject({
      factor: MATCH_FACTOR_IDS.DESTINATION_COMPATIBILITY,
      eligible: true,
      threshold: 5000,
    });
  });

  it('rejects just outside each threshold boundary', () => {
    const outsidePickup = discoveredRide({ distanceMeters: 5001 });
    const outsideTime = discoveredRide({
      departureDateTime: new Date('2026-08-20T11:01:00.000Z'),
    });
    // Destination ~111 km away (same fixture as the factor boundary test).
    const outsideDestination = discoveredRide({
      destinationLocation: {
        id: 'loc-destination-far',
        latitude: 13.9,
        longitude: 76.6394,
        label: 'far destination',
      },
    });

    const [pickup] = matchRides(input, [outsidePickup], approvedConfig);
    expect(pickup.factors[0].eligible).toBe(false);

    const [time] = matchRides(input, [outsideTime], approvedConfig);
    expect(time.factors[2].eligible).toBe(false);

    const [destination] = matchRides(
      input,
      [outsideDestination],
      approvedConfig,
    );
    expect(destination.factors[1].eligible).toBe(false);
  });

  it('exposes structured factor results with measured value, threshold, and deterministic reason', () => {
    const [matched] = matchRides(input, [discoveredRide()], approvedConfig);
    const pickup = matched.factors[0];
    expect(pickup).toMatchObject({
      factor: MATCH_FACTOR_IDS.PICKUP_PROXIMITY,
      value: 800,
      threshold: 5000,
    });
    expect(typeof pickup.reason).toBe('string');
    expect(pickup.reason).toContain('800m');
    expect(pickup.reason).toContain('5000m');
  });

  it('exposes no numeric relevance score', () => {
    const [matched] = matchRides(input, [discoveredRide()], approvedConfig);
    expect(Object.keys(matched)).not.toContain('score');
    for (const factor of matched.factors) {
      expect(Object.keys(factor)).not.toContain('score');
      expect(Object.keys(factor)).not.toContain('weight');
    }
  });
});

describe('matchRides — server-owned result cap (OD-004, Phase 3.19)', () => {
  const manyCandidates = Array.from({ length: 25 }, (_, index) =>
    discoveredRide({ id: `ride-${index}`, distanceMeters: 100 + index }),
  );

  it('caps results at the server-owned maximum after ranking', () => {
    const results = matchRides(input, manyCandidates, config, 20);
    expect(results).toHaveLength(20);
  });

  it('returns the highest-ranked candidates within the cap', () => {
    const results = matchRides(input, manyCandidates, config, 20);
    expect(results[0].ride.id).toBe('ride-0');
    expect(results[19].ride.id).toBe('ride-19');
    expect(results.map((r) => r.ride.id)).not.toContain('ride-20');
  });

  it('does not cap when maxResults is omitted (backward compatible)', () => {
    const results = matchRides(input, manyCandidates, config);
    expect(results).toHaveLength(25);
  });

  it('returns all candidates when the cap exceeds the candidate count', () => {
    const results = matchRides(input, manyCandidates.slice(0, 3), config, 20);
    expect(results).toHaveLength(3);
  });

  it('rejects a non-positive or non-integer maxResults', () => {
    for (const maxResults of [0, -1, 2.5]) {
      expect(() =>
        matchRides(input, manyCandidates, config, maxResults),
      ).toThrow(/maxResults/);
    }
  });
});
