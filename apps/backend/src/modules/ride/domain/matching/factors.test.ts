/**
 * Unit tests for the five documented matching factors (Phase 3.4).
 *
 * Covers normal values, minimum/maximum boundaries (inclusive, matching the
 * model's tolerance semantics), and the status/availability edge cases. All
 * factors are pure — no database.
 *
 * `docs/domain/matching-model.md` §4 factor order: pickup proximity,
 * destination compatibility, time compatibility, seat availability, ride
 * status.
 */
import { describe, expect, it } from 'vitest';
import { RideStatus } from '@prisma/client';
import { evaluatePickupProximity } from './factors/pickup-proximity.js';
import { evaluateDestinationCompatibility } from './factors/destination-compatibility.js';
import { evaluateTimeCompatibility } from './factors/time-compatibility.js';
import { evaluateSeatAvailability } from './factors/seat-availability.js';
import { evaluateRideStatus } from './factors/ride-status.js';
import { MATCH_FACTOR_IDS } from './types.js';
import type { MatchingConfiguration } from './types.js';

const config: MatchingConfiguration = {
  pickupRadiusMeters: 5000,
  departureTimeWindowMinutes: 60,
  destinationToleranceMeters: 5000,
};

const PREFERRED = new Date('2026-08-20T10:00:00.000Z');

describe('evaluatePickupProximity (factor 1)', () => {
  it('passes when the pickup is within the configured radius', () => {
    const result = evaluatePickupProximity(
      { pickupDistanceMeters: 823 },
      config,
    );
    expect(result.eligible).toBe(true);
    expect(result.factor).toBe(MATCH_FACTOR_IDS.PICKUP_PROXIMITY);
    expect(result.value).toBe(823);
    expect(result.threshold).toBe(5000);
  });

  it('passes at zero distance', () => {
    expect(
      evaluatePickupProximity({ pickupDistanceMeters: 0 }, config).eligible,
    ).toBe(true);
  });

  it('passes exactly at the boundary (inclusive)', () => {
    expect(
      evaluatePickupProximity({ pickupDistanceMeters: 5000 }, config).eligible,
    ).toBe(true);
  });

  it('fails just beyond the boundary', () => {
    const result = evaluatePickupProximity(
      { pickupDistanceMeters: 5001 },
      config,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('5001m');
    expect(result.reason).toContain('5000m');
  });
});

describe('evaluateDestinationCompatibility (factor 2)', () => {
  it('passes for an identical destination point', () => {
    const result = evaluateDestinationCompatibility(
      { latitude: 12.2958, longitude: 76.6394 },
      {
        id: 'r1',
        status: RideStatus.PUBLISHED,
        departureDateTime: PREFERRED,
        availableSeats: 2,
        pickupDistanceMeters: 0,
        destination: { latitude: 12.2958, longitude: 76.6394 },
      },
      config,
    );
    expect(result.eligible).toBe(true);
    expect(result.value).toBeLessThan(1);
  });

  it('passes within the tolerance', () => {
    const result = evaluateDestinationCompatibility(
      { latitude: 12.3005, longitude: 76.6394 },
      {
        id: 'r1',
        status: RideStatus.PUBLISHED,
        departureDateTime: PREFERRED,
        availableSeats: 2,
        pickupDistanceMeters: 0,
        destination: { latitude: 12.2958, longitude: 76.6394 },
      },
      config,
    );
    expect(result.eligible).toBe(true);
  });

  it('fails beyond the tolerance (destination ~111 km away)', () => {
    const result = evaluateDestinationCompatibility(
      { latitude: 13.9, longitude: 76.6394 },
      {
        id: 'r1',
        status: RideStatus.PUBLISHED,
        departureDateTime: PREFERRED,
        availableSeats: 2,
        pickupDistanceMeters: 0,
        destination: { latitude: 12.2958, longitude: 76.6394 },
      },
      config,
    );
    expect(result.eligible).toBe(false);
    expect(result.value).toBeGreaterThan(100_000);
    expect(result.threshold).toBe(5000);
  });
});

describe('evaluateTimeCompatibility (factor 3)', () => {
  const rideDeparture = PREFERRED;

  it('passes at the exact preferred time', () => {
    const result = evaluateTimeCompatibility(PREFERRED, rideDeparture, config);
    expect(result.eligible).toBe(true);
    expect(result.value).toBe(0);
  });

  it('passes within the window', () => {
    const result = evaluateTimeCompatibility(
      PREFERRED,
      new Date(PREFERRED.getTime() + 30 * 60_000),
      config,
    );
    expect(result.eligible).toBe(true);
    expect(result.value).toBe(30);
  });

  it('passes exactly at the window edge (inclusive)', () => {
    const result = evaluateTimeCompatibility(
      PREFERRED,
      new Date(PREFERRED.getTime() + 60 * 60_000),
      config,
    );
    expect(result.eligible).toBe(true);
    expect(result.value).toBe(60);
  });

  it('fails just beyond the window', () => {
    const result = evaluateTimeCompatibility(
      PREFERRED,
      new Date(PREFERRED.getTime() + 61 * 60_000),
      config,
    );
    expect(result.eligible).toBe(false);
    expect(result.value).toBe(61);
  });

  it('uses absolute difference (rides departing before the preference are symmetric)', () => {
    const before = evaluateTimeCompatibility(
      PREFERRED,
      new Date(PREFERRED.getTime() - 30 * 60_000),
      config,
    );
    const after = evaluateTimeCompatibility(
      PREFERRED,
      new Date(PREFERRED.getTime() + 30 * 60_000),
      config,
    );
    expect(before.eligible).toBe(true);
    expect(before.value).toBe(after.value);
  });
});

describe('evaluateSeatAvailability (factor 4)', () => {
  it('passes when available seats are sufficient', () => {
    const result = evaluateSeatAvailability({ availableSeats: 2 }, 1);
    expect(result.eligible).toBe(true);
    expect(result.value).toBe(2);
    expect(result.threshold).toBe(1);
  });

  it('passes exactly at the requested count (inclusive)', () => {
    expect(evaluateSeatAvailability({ availableSeats: 3 }, 3).eligible).toBe(
      true,
    );
  });

  it('fails when available seats fall short of the requested count', () => {
    const result = evaluateSeatAvailability({ availableSeats: 2 }, 3);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('2');
    expect(result.reason).toContain('3');
  });

  it('fails when no seats remain', () => {
    expect(evaluateSeatAvailability({ availableSeats: 0 }, 1).eligible).toBe(
      false,
    );
  });
});

describe('evaluateRideStatus (factor 5)', () => {
  it.each([RideStatus.PUBLISHED, RideStatus.CONFIRMED])(
    'passes for active status %s',
    (status) => {
      const result = evaluateRideStatus({ status });
      expect(result.eligible).toBe(true);
      expect(result.value).toBe(status);
    },
  );

  it.each([
    RideStatus.DRAFT,
    RideStatus.IN_PROGRESS,
    RideStatus.COMPLETED,
    RideStatus.CANCELLED,
    RideStatus.EXPIRED,
  ])('fails for non-active status %s', (status) => {
    const result = evaluateRideStatus({ status });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain(status);
  });
});
