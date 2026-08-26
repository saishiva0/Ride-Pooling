/**
 * Unit tests for the Phase 3.5 ride request domain rules.
 *
 * Pure predicates — no database. Verifies the documented request rules:
 * seat count bounds, requestable ride states, seat sufficiency, and the
 * constants that mirror the lifecycle doc and the Phase 2 partial unique
 * index (which statuses count as active for duplicates).
 */
import { describe, expect, it } from 'vitest';
import { RideRequestStatus, RideStatus } from '@prisma/client';
import {
  ACTIVE_REQUEST_STATUSES,
  hasSufficientSeats,
  isRequestableRideStatus,
  isValidRequestedSeats,
  REQUESTABLE_RIDE_STATUSES,
} from './request-rules.js';

describe('isValidRequestedSeats', () => {
  it('accepts a positive integer', () => {
    expect(isValidRequestedSeats(1)).toBe(true);
    expect(isValidRequestedSeats(3)).toBe(true);
  });

  it('rejects zero and negative values', () => {
    expect(isValidRequestedSeats(0)).toBe(false);
    expect(isValidRequestedSeats(-2)).toBe(false);
  });

  it('rejects non-integers and non-finite values', () => {
    expect(isValidRequestedSeats(2.5)).toBe(false);
    expect(isValidRequestedSeats(Number.NaN)).toBe(false);
    expect(isValidRequestedSeats(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('isRequestableRideStatus', () => {
  it.each([RideStatus.PUBLISHED, RideStatus.CONFIRMED])(
    'accepts the requestable status %s',
    (status) => {
      expect(isRequestableRideStatus(status)).toBe(true);
    },
  );

  it.each([
    RideStatus.DRAFT,
    RideStatus.IN_PROGRESS,
    RideStatus.COMPLETED,
    RideStatus.CANCELLED,
    RideStatus.EXPIRED,
  ])('rejects the non-requestable status %s', (status) => {
    expect(isRequestableRideStatus(status)).toBe(false);
  });

  it('lists exactly the documented requestable states', () => {
    expect(REQUESTABLE_RIDE_STATUSES).toEqual([
      RideStatus.PUBLISHED,
      RideStatus.CONFIRMED,
    ]);
  });
});

describe('hasSufficientSeats', () => {
  it('passes when available seats are enough', () => {
    expect(hasSufficientSeats(2, 3)).toBe(true);
  });

  it('passes exactly at the requested count (inclusive)', () => {
    expect(hasSufficientSeats(3, 3)).toBe(true);
  });

  it('fails when available seats fall short', () => {
    expect(hasSufficientSeats(3, 2)).toBe(false);
  });
});

describe('ACTIVE_REQUEST_STATUSES', () => {
  it('mirrors the Phase 2 partial unique index (PENDING/ACCEPTED)', () => {
    expect(ACTIVE_REQUEST_STATUSES).toEqual([
      RideRequestStatus.PENDING,
      RideRequestStatus.ACCEPTED,
    ]);
  });
});
