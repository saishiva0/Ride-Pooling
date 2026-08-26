/**
 * Unit tests for Phase 3.7 ride expiration domain rules.
 *
 * Pure predicates only — no database. Fixed timestamps are used throughout;
 * no wall-clock time is ever read, so the departure-window behaviour is fully
 * deterministic. Verifies that only PUBLISHED rides can expire and that the
 * grace window is an explicit argument (OD-002 policy), never a hidden value.
 */
import { describe, expect, it } from 'vitest';
import { RideStatus } from '@prisma/client';
import {
  canExpireRide,
  EXPIRABLE_RIDE_STATUSES,
  hasDeparturePassed,
  isExpirableRideStatus,
} from './expiration-rules.js';

const REF = new Date('2026-08-20T10:00:00.000Z');
const DEPARTURE_PAST = new Date('2026-08-20T09:59:59.000Z');
const DEPARTURE_EQUAL = new Date('2026-08-20T10:00:00.000Z');
const DEPARTURE_FUTURE = new Date('2026-08-20T10:00:01.000Z');

describe('EXPIRABLE_RIDE_STATUSES / isExpirableRideStatus', () => {
  it('contains only PUBLISHED (ride-lifecycle.md §2.7/§5)', () => {
    expect(EXPIRABLE_RIDE_STATUSES).toEqual([RideStatus.PUBLISHED]);
  });

  it.each([RideStatus.PUBLISHED])('marks %s as expirable', (status) => {
    expect(isExpirableRideStatus(status)).toBe(true);
  });

  it.each([
    RideStatus.DRAFT,
    RideStatus.CONFIRMED,
    RideStatus.IN_PROGRESS,
    RideStatus.COMPLETED,
    RideStatus.CANCELLED,
    RideStatus.EXPIRED,
  ])('marks %s as NOT expirable', (status) => {
    expect(isExpirableRideStatus(status)).toBe(false);
  });
});

describe('hasDeparturePassed', () => {
  it('is true when referenceTime is after the departure datetime', () => {
    expect(hasDeparturePassed(REF, DEPARTURE_PAST, 0)).toBe(true);
  });

  it('is false when referenceTime equals the departure datetime', () => {
    // `now > departure + grace` is a strict inequality (ride-lifecycle.md §5).
    expect(hasDeparturePassed(REF, DEPARTURE_EQUAL, 0)).toBe(false);
  });

  it('is false when referenceTime is before the departure datetime', () => {
    expect(hasDeparturePassed(REF, DEPARTURE_FUTURE, 0)).toBe(false);
  });

  it('applies an explicit grace window supplied by the caller (OD-002 policy)', () => {
    // departure = 09:59:59, grace = 2000ms → threshold 10:00:01 > 10:00:00.
    expect(hasDeparturePassed(REF, DEPARTURE_PAST, 2000)).toBe(false);
    // grace = 1000ms → threshold 10:00:00, reference is not strictly greater.
    expect(hasDeparturePassed(REF, DEPARTURE_PAST, 1000)).toBe(false);
    // grace = 0 → the documented baseline (departure simply passed).
    expect(hasDeparturePassed(REF, DEPARTURE_PAST, 0)).toBe(true);
  });
});

describe('canExpireRide', () => {
  const eligible = {
    status: RideStatus.PUBLISHED,
    departureDateTime: DEPARTURE_PAST,
    referenceTime: REF,
    graceWindowMs: 0,
  };

  it('is true for a PUBLISHED ride whose departure has passed', () => {
    expect(canExpireRide(eligible)).toBe(true);
  });

  it('is false when the ride is not PUBLISHED', () => {
    for (const status of Object.values(RideStatus)) {
      expect(
        canExpireRide({
          status,
          departureDateTime: DEPARTURE_PAST,
          referenceTime: REF,
          graceWindowMs: 0,
        }),
      ).toBe(status === RideStatus.PUBLISHED);
    }
  });

  it('is false when the departure window has not passed', () => {
    expect(
      canExpireRide({ ...eligible, departureDateTime: DEPARTURE_FUTURE }),
    ).toBe(false);
    expect(
      canExpireRide({ ...eligible, departureDateTime: DEPARTURE_EQUAL }),
    ).toBe(false);
  });

  it('is false when a supplied grace window keeps the departure in the future', () => {
    expect(canExpireRide({ ...eligible, graceWindowMs: 5000 })).toBe(false);
  });
});
