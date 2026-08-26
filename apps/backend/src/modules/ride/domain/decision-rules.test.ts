/**
 * Unit tests for the Phase 3.6 ride request decision domain rules.
 *
 * Pure predicates — no database. Verifies the documented decision rules:
 * pending-request gating, acceptable ride states, seat availability, the
 * composable canAcceptRequest/canRejectRequest predicates, and the initial
 * participant status (CONFIRMED).
 */
import { describe, expect, it } from 'vitest';
import {
  ParticipantStatus,
  RideRequestStatus,
  RideStatus,
} from '@prisma/client';
import {
  canAcceptRequest,
  canRejectRequest,
  hasAvailableSeats,
  INITIAL_PARTICIPANT_STATUS,
  isAcceptableRideStatus,
  isPendingRequest,
} from './decision-rules.js';

describe('INITIAL_PARTICIPANT_STATUS', () => {
  it('initializes accepted participants as CONFIRMED (ride-lifecycle.md §6)', () => {
    expect(INITIAL_PARTICIPANT_STATUS).toBe(ParticipantStatus.CONFIRMED);
  });
});

describe('isPendingRequest', () => {
  it('accepts only PENDING', () => {
    expect(isPendingRequest(RideRequestStatus.PENDING)).toBe(true);
    expect(isPendingRequest(RideRequestStatus.ACCEPTED)).toBe(false);
    expect(isPendingRequest(RideRequestStatus.REJECTED)).toBe(false);
    expect(isPendingRequest(RideRequestStatus.CANCELLED)).toBe(false);
  });
});

describe('isAcceptableRideStatus', () => {
  it('accepts PUBLISHED and CONFIRMED (same set as requestability)', () => {
    expect(isAcceptableRideStatus(RideStatus.PUBLISHED)).toBe(true);
    expect(isAcceptableRideStatus(RideStatus.CONFIRMED)).toBe(true);
  });

  it('rejects DRAFT, IN_PROGRESS, and terminal states', () => {
    expect(isAcceptableRideStatus(RideStatus.DRAFT)).toBe(false);
    expect(isAcceptableRideStatus(RideStatus.IN_PROGRESS)).toBe(false);
    expect(isAcceptableRideStatus(RideStatus.COMPLETED)).toBe(false);
    expect(isAcceptableRideStatus(RideStatus.CANCELLED)).toBe(false);
    expect(isAcceptableRideStatus(RideStatus.EXPIRED)).toBe(false);
  });
});

describe('hasAvailableSeats', () => {
  it('passes when total − confirmed is enough', () => {
    expect(hasAvailableSeats(2, 1, 4)).toBe(true);
  });

  it('passes exactly at the boundary (inclusive)', () => {
    expect(hasAvailableSeats(2, 2, 4)).toBe(true);
  });

  it('fails when the request exceeds the live free seats', () => {
    expect(hasAvailableSeats(3, 2, 4)).toBe(false);
  });

  it('fails when the ride is already full', () => {
    expect(hasAvailableSeats(1, 4, 4)).toBe(false);
  });
});

describe('canAcceptRequest', () => {
  const base = {
    requestStatus: RideRequestStatus.PENDING,
    rideStatus: RideStatus.PUBLISHED,
    requestedSeats: 1,
    confirmedSeats: 0,
    totalSeats: 3,
  };

  it('accepts a valid combination', () => {
    expect(canAcceptRequest(base)).toBe(true);
  });

  it('accepts on a CONFIRMED ride while seats remain', () => {
    expect(
      canAcceptRequest({ ...base, rideStatus: RideStatus.CONFIRMED }),
    ).toBe(true);
  });

  it('rejects a non-pending request', () => {
    expect(
      canAcceptRequest({ ...base, requestStatus: RideRequestStatus.ACCEPTED }),
    ).toBe(false);
    expect(
      canAcceptRequest({ ...base, requestStatus: RideRequestStatus.REJECTED }),
    ).toBe(false);
    expect(
      canAcceptRequest({ ...base, requestStatus: RideRequestStatus.CANCELLED }),
    ).toBe(false);
  });

  it('rejects a non-acceptable ride status', () => {
    for (const rideStatus of [
      RideStatus.DRAFT,
      RideStatus.IN_PROGRESS,
      RideStatus.COMPLETED,
      RideStatus.CANCELLED,
      RideStatus.EXPIRED,
    ]) {
      expect(canAcceptRequest({ ...base, rideStatus })).toBe(false);
    }
  });

  it('rejects when seats are insufficient', () => {
    expect(
      canAcceptRequest({ ...base, requestedSeats: 4, totalSeats: 3 }),
    ).toBe(false);
    expect(
      canAcceptRequest({ ...base, requestedSeats: 2, confirmedSeats: 2 }),
    ).toBe(false);
  });
});

describe('canRejectRequest', () => {
  it('allows rejecting only a PENDING request', () => {
    expect(canRejectRequest(RideRequestStatus.PENDING)).toBe(true);
    expect(canRejectRequest(RideRequestStatus.ACCEPTED)).toBe(false);
    expect(canRejectRequest(RideRequestStatus.REJECTED)).toBe(false);
    expect(canRejectRequest(RideRequestStatus.CANCELLED)).toBe(false);
  });
});
