/**
 * Unit tests for the Phase 3.21 request/participation cancellation domain
 * rules.
 *
 * Pure, deterministic, no database: verifies the PENDING-withdrawal
 * predicate, the ACCEPTED-participation-cancellation predicate (including the
 * IN_PROGRESS prohibition — OD-011), and the CONFIRMED → PUBLISHED revert
 * predicate.
 */
import { describe, expect, it } from 'vitest';
import { RideRequestStatus, RideStatus } from '@prisma/client';
import {
  isCancellableParticipation,
  isWithdrawableRequest,
  shouldRevertToPublished,
} from './request-cancellation-rules.js';

describe('isWithdrawableRequest', () => {
  it('accepts only PENDING requests', () => {
    expect(isWithdrawableRequest(RideRequestStatus.PENDING)).toBe(true);
  });

  it.each([
    RideRequestStatus.ACCEPTED,
    RideRequestStatus.REJECTED,
    RideRequestStatus.CANCELLED,
  ])('rejects %s requests (not withdrawable)', (status) => {
    expect(isWithdrawableRequest(status)).toBe(false);
  });
});

describe('isCancellableParticipation', () => {
  it('accepts an ACCEPTED request on any non-IN_PROGRESS ride state', () => {
    const rideStatuses = [
      RideStatus.DRAFT,
      RideStatus.PUBLISHED,
      RideStatus.CONFIRMED,
      RideStatus.COMPLETED,
      RideStatus.CANCELLED,
      RideStatus.EXPIRED,
    ];
    for (const rideStatus of rideStatuses) {
      expect(
        isCancellableParticipation({
          requestStatus: RideRequestStatus.ACCEPTED,
          rideStatus,
        }),
      ).toBe(true);
    }
  });

  it('rejects an ACCEPTED request on an IN_PROGRESS ride (OD-011)', () => {
    expect(
      isCancellableParticipation({
        requestStatus: RideRequestStatus.ACCEPTED,
        rideStatus: RideStatus.IN_PROGRESS,
      }),
    ).toBe(false);
  });

  it('rejects a non-ACCEPTED request regardless of ride state', () => {
    for (const status of [
      RideRequestStatus.PENDING,
      RideRequestStatus.REJECTED,
      RideRequestStatus.CANCELLED,
    ]) {
      for (const rideStatus of Object.values(RideStatus)) {
        expect(
          isCancellableParticipation({ requestStatus: status, rideStatus }),
        ).toBe(false);
      }
    }
  });
});

describe('shouldRevertToPublished', () => {
  it('reverts a CONFIRMED ride with no remaining confirmed seats', () => {
    expect(
      shouldRevertToPublished({
        rideStatus: RideStatus.CONFIRMED,
        remainingConfirmedSeats: 0,
      }),
    ).toBe(true);
  });

  it('does not revert a CONFIRMED ride that still has confirmed seats', () => {
    for (const remaining of [1, 2, 5]) {
      expect(
        shouldRevertToPublished({
          rideStatus: RideStatus.CONFIRMED,
          remainingConfirmedSeats: remaining,
        }),
      ).toBe(false);
    }
  });

  it('does not revert a non-CONFIRMED ride even with zero seats', () => {
    for (const rideStatus of [
      RideStatus.DRAFT,
      RideStatus.PUBLISHED,
      RideStatus.IN_PROGRESS,
      RideStatus.COMPLETED,
      RideStatus.CANCELLED,
      RideStatus.EXPIRED,
    ]) {
      expect(
        shouldRevertToPublished({
          rideStatus,
          remainingConfirmedSeats: 0,
        }),
      ).toBe(false);
    }
  });
});
