import { describe, expect, it } from 'vitest';
import { RideStatus } from '@prisma/client';
import {
  canTransitionRideStatus,
  getAllowedRideTransitions,
  isTerminalRideStatus,
  RIDE_TERMINAL_STATES,
  transitionRideStatus,
} from './ride-state-machine.js';
import { RideTransitionError } from './ride.errors.js';

/**
 * Expected transitions transcribed independently from
 * `docs/domain/ride-lifecycle.md` (§2 state descriptions, §3 diagram, §4
 * cancellation paths, §5 expiration) — kept separate from the
 * implementation's `RIDE_TRANSITIONS` map so this test actually verifies
 * the map against the documented lifecycle rather than against itself.
 */
const EXPECTED_TRANSITIONS: Record<RideStatus, RideStatus[]> = {
  [RideStatus.DRAFT]: [RideStatus.PUBLISHED, RideStatus.CANCELLED],
  [RideStatus.PUBLISHED]: [
    RideStatus.CONFIRMED,
    RideStatus.IN_PROGRESS,
    RideStatus.CANCELLED,
    RideStatus.EXPIRED,
  ],
  [RideStatus.CONFIRMED]: [
    RideStatus.IN_PROGRESS,
    RideStatus.CANCELLED,
    RideStatus.PUBLISHED,
  ],
  [RideStatus.IN_PROGRESS]: [RideStatus.COMPLETED, RideStatus.CANCELLED],
  [RideStatus.COMPLETED]: [],
  [RideStatus.CANCELLED]: [],
  [RideStatus.EXPIRED]: [],
};

const ALL_STATUSES = Object.values(RideStatus);
const EXPECTED_TERMINAL_STATES = new Set<RideStatus>([
  RideStatus.COMPLETED,
  RideStatus.CANCELLED,
  RideStatus.EXPIRED,
]);

describe('ride state machine — exhaustive transition matrix', () => {
  for (const from of ALL_STATUSES) {
    const allowed = new Set(EXPECTED_TRANSITIONS[from]);

    for (const to of ALL_STATUSES) {
      const shouldAllow = allowed.has(to);

      it(`${from} -> ${to} is ${shouldAllow ? 'allowed' : 'rejected'}`, () => {
        expect(canTransitionRideStatus(from, to)).toBe(shouldAllow);

        if (shouldAllow) {
          expect(transitionRideStatus(from, to)).toBe(to);
          return;
        }

        expect(() => transitionRideStatus(from, to)).toThrow(
          RideTransitionError,
        );

        let caught: unknown;
        try {
          transitionRideStatus(from, to);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(RideTransitionError);
        const transitionErr = caught as RideTransitionError;
        expect(transitionErr.currentState).toBe(from);
        expect(transitionErr.requestedState).toBe(to);
        expect(transitionErr.code).toBe('BUSINESS_RULE_VIOLATION');
        expect(transitionErr.statusCode).toBe(422);
        expect(transitionErr.reason).toBe(
          EXPECTED_TERMINAL_STATES.has(from)
            ? 'TERMINAL_STATE'
            : 'UNSUPPORTED_TRANSITION',
        );
      });
    }
  }
});

describe('getAllowedRideTransitions', () => {
  it('returns the exact documented destination set for each status', () => {
    for (const from of ALL_STATUSES) {
      const actual = new Set(getAllowedRideTransitions(from));
      const expected = new Set(EXPECTED_TRANSITIONS[from]);
      expect(actual).toEqual(expected);
    }
  });
});

describe('isTerminalRideStatus', () => {
  it('identifies COMPLETED, CANCELLED, and EXPIRED as terminal', () => {
    expect(isTerminalRideStatus(RideStatus.COMPLETED)).toBe(true);
    expect(isTerminalRideStatus(RideStatus.CANCELLED)).toBe(true);
    expect(isTerminalRideStatus(RideStatus.EXPIRED)).toBe(true);
  });

  it('identifies DRAFT, PUBLISHED, CONFIRMED, IN_PROGRESS as non-terminal', () => {
    expect(isTerminalRideStatus(RideStatus.DRAFT)).toBe(false);
    expect(isTerminalRideStatus(RideStatus.PUBLISHED)).toBe(false);
    expect(isTerminalRideStatus(RideStatus.CONFIRMED)).toBe(false);
    expect(isTerminalRideStatus(RideStatus.IN_PROGRESS)).toBe(false);
  });

  it('matches RIDE_TERMINAL_STATES', () => {
    expect(new Set(RIDE_TERMINAL_STATES)).toEqual(EXPECTED_TERMINAL_STATES);
  });
});

describe('specific documented scenarios (named for readability)', () => {
  it('allows DRAFT -> PUBLISHED (creator publishes)', () => {
    expect(transitionRideStatus(RideStatus.DRAFT, RideStatus.PUBLISHED)).toBe(
      RideStatus.PUBLISHED,
    );
  });

  it('allows PUBLISHED -> CONFIRMED (first request accepted)', () => {
    expect(
      transitionRideStatus(RideStatus.PUBLISHED, RideStatus.CONFIRMED),
    ).toBe(RideStatus.CONFIRMED);
  });

  it('allows PUBLISHED -> IN_PROGRESS (start with no participants)', () => {
    expect(
      transitionRideStatus(RideStatus.PUBLISHED, RideStatus.IN_PROGRESS),
    ).toBe(RideStatus.IN_PROGRESS);
  });

  it('allows PUBLISHED -> EXPIRED (departure passed without starting)', () => {
    expect(transitionRideStatus(RideStatus.PUBLISHED, RideStatus.EXPIRED)).toBe(
      RideStatus.EXPIRED,
    );
  });

  it('allows CONFIRMED -> IN_PROGRESS (creator starts)', () => {
    expect(
      transitionRideStatus(RideStatus.CONFIRMED, RideStatus.IN_PROGRESS),
    ).toBe(RideStatus.IN_PROGRESS);
  });

  it('allows the CONFIRMED -> PUBLISHED revert (last confirmed participant cancels)', () => {
    expect(
      transitionRideStatus(RideStatus.CONFIRMED, RideStatus.PUBLISHED),
    ).toBe(RideStatus.PUBLISHED);
  });

  it('allows IN_PROGRESS -> COMPLETED (creator completes)', () => {
    expect(
      transitionRideStatus(RideStatus.IN_PROGRESS, RideStatus.COMPLETED),
    ).toBe(RideStatus.COMPLETED);
  });

  it.each([
    RideStatus.DRAFT,
    RideStatus.PUBLISHED,
    RideStatus.CONFIRMED,
    RideStatus.IN_PROGRESS,
  ])('allows creator cancellation from %s', (from) => {
    expect(transitionRideStatus(from, RideStatus.CANCELLED)).toBe(
      RideStatus.CANCELLED,
    );
  });

  it.each([RideStatus.COMPLETED, RideStatus.CANCELLED, RideStatus.EXPIRED])(
    'rejects every transition out of terminal state %s',
    (from) => {
      for (const to of ALL_STATUSES) {
        expect(canTransitionRideStatus(from, to)).toBe(false);
      }
    },
  );

  it('rejects same-state transitions (no self-loops are documented)', () => {
    for (const status of ALL_STATUSES) {
      expect(canTransitionRideStatus(status, status)).toBe(false);
      expect(() => transitionRideStatus(status, status)).toThrow(
        RideTransitionError,
      );
    }
  });

  it('rejects undocumented backwards transitions (e.g. PUBLISHED -> DRAFT)', () => {
    expect(
      canTransitionRideStatus(RideStatus.PUBLISHED, RideStatus.DRAFT),
    ).toBe(false);
    expect(
      canTransitionRideStatus(RideStatus.IN_PROGRESS, RideStatus.PUBLISHED),
    ).toBe(false);
    expect(
      canTransitionRideStatus(RideStatus.CONFIRMED, RideStatus.DRAFT),
    ).toBe(false);
  });

  it('rejects an unknown/invalid status value without throwing unexpectedly', () => {
    const unknown = 'NOT_A_REAL_STATUS' as RideStatus;
    expect(canTransitionRideStatus(unknown, RideStatus.DRAFT)).toBe(false);
    expect(() => transitionRideStatus(unknown, RideStatus.DRAFT)).toThrow(
      RideTransitionError,
    );
  });
});
