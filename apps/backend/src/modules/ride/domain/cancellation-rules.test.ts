/**
 * Unit tests for Phase 3.7 ride cancellation domain rules.
 *
 * Pure predicates only — no database, no time. Verifies that cancellation is
 * allowed exactly from the lifecycle-documented source states and that the
 * predicate delegates to the Phase 3.1 state machine (so it can never diverge
 * from the transition map).
 */
import { describe, expect, it } from 'vitest';
import { RideStatus } from '@prisma/client';
import { canCancelRide } from './cancellation-rules.js';
import { canTransitionRideStatus } from './ride-state-machine.js';

describe('canCancelRide', () => {
  it.each([
    RideStatus.DRAFT,
    RideStatus.PUBLISHED,
    RideStatus.CONFIRMED,
    RideStatus.IN_PROGRESS,
  ])('allows cancellation from %s (ride-lifecycle.md §2.1–§2.4)', (status) => {
    expect(canCancelRide(status)).toBe(true);
  });

  it.each([RideStatus.COMPLETED, RideStatus.CANCELLED, RideStatus.EXPIRED])(
    'rejects cancellation from the terminal state %s',
    (status) => {
      expect(canCancelRide(status)).toBe(false);
    },
  );

  it('is exactly the state machine transition to CANCELLED for every status', () => {
    // The predicate is a named wrapper over the Phase 3.1 state machine, so
    // it must agree with it for the entire enum — no duplicated logic.
    for (const status of Object.values(RideStatus)) {
      expect(canCancelRide(status)).toBe(
        canTransitionRideStatus(status, RideStatus.CANCELLED),
      );
    }
  });
});
