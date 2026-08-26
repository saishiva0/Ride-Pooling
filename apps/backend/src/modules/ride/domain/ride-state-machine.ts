/**
 * Ride lifecycle state machine (Phase 3.1).
 *
 * Pure, deterministic, and side-effect free: no database access, no HTTP,
 * no logging, no notifications, no events. It only answers "is this
 * transition allowed?" and "what state results?". Orchestration (applying
 * the transition to a persisted Ride, writing `RideStatusHistory`, emitting
 * events) belongs to a later Ride application-service phase.
 *
 * The transition map below is the single source of truth in code and must
 * mirror `docs/domain/ride-lifecycle.md` exactly — every entry traces to a
 * transition documented there (§2 state descriptions, §3 diagram, §4
 * cancellation paths, §5 expiration). Do not add, remove, or infer
 * transitions beyond what is documented.
 */
import { RideStatus } from '@prisma/client';
import { RideTransitionError } from './ride.errors.js';

/**
 * Allowed destination states for each ride status.
 *
 * - DRAFT       → PUBLISHED (publish), CANCELLED (discard)                 [§2.1]
 * - PUBLISHED   → CONFIRMED (first accept), IN_PROGRESS (start),
 *                 CANCELLED (cancel), EXPIRED (departure passed)           [§2.2]
 * - CONFIRMED   → IN_PROGRESS (start), CANCELLED (cancel),
 *                 PUBLISHED (last confirmed participant cancels)           [§2.3, §4.2]
 * - IN_PROGRESS → COMPLETED (finish), CANCELLED (exceptional cancel)       [§2.4]
 * - COMPLETED   → (terminal, no transitions)                              [§2.5]
 * - CANCELLED   → (terminal, no transitions)                              [§2.6]
 * - EXPIRED     → (terminal, no transitions)                              [§2.7]
 */
const RIDE_TRANSITIONS: Readonly<Record<RideStatus, ReadonlySet<RideStatus>>> =
  {
    [RideStatus.DRAFT]: new Set([RideStatus.PUBLISHED, RideStatus.CANCELLED]),
    [RideStatus.PUBLISHED]: new Set([
      RideStatus.CONFIRMED,
      RideStatus.IN_PROGRESS,
      RideStatus.CANCELLED,
      RideStatus.EXPIRED,
    ]),
    [RideStatus.CONFIRMED]: new Set([
      RideStatus.IN_PROGRESS,
      RideStatus.CANCELLED,
      RideStatus.PUBLISHED,
    ]),
    [RideStatus.IN_PROGRESS]: new Set([
      RideStatus.COMPLETED,
      RideStatus.CANCELLED,
    ]),
    [RideStatus.COMPLETED]: new Set(),
    [RideStatus.CANCELLED]: new Set(),
    [RideStatus.EXPIRED]: new Set(),
  };

/** Terminal states accept no further transitions (`ride-lifecycle.md` §2.5–§2.7). */
export const RIDE_TERMINAL_STATES: ReadonlySet<RideStatus> = new Set([
  RideStatus.COMPLETED,
  RideStatus.CANCELLED,
  RideStatus.EXPIRED,
]);

/** Whether the given status is terminal (accepts no further transitions). */
export function isTerminalRideStatus(status: RideStatus): boolean {
  return RIDE_TERMINAL_STATES.has(status);
}

/**
 * The set of states reachable from `from` in a single transition. Returns
 * an empty array for terminal or unrecognized states.
 */
export function getAllowedRideTransitions(from: RideStatus): RideStatus[] {
  return Array.from(RIDE_TRANSITIONS[from] ?? []);
}

/** Whether `from → to` is an explicitly allowed transition. */
export function canTransitionRideStatus(
  from: RideStatus,
  to: RideStatus,
): boolean {
  return RIDE_TRANSITIONS[from]?.has(to) ?? false;
}

/**
 * Validates a ride status transition and returns the resulting state.
 *
 * Throws `RideTransitionError` when the transition is not explicitly
 * allowed — with `reason: 'TERMINAL_STATE'` when `from` is a terminal
 * state, otherwise `reason: 'UNSUPPORTED_TRANSITION'` (covers backwards,
 * same-state, and any other undocumented transition).
 *
 * Pure: does not mutate any ride, does not touch the database, and
 * produces no side effects.
 */
export function transitionRideStatus(
  from: RideStatus,
  to: RideStatus,
): RideStatus {
  if (!canTransitionRideStatus(from, to)) {
    throw new RideTransitionError(
      from,
      to,
      isTerminalRideStatus(from) ? 'TERMINAL_STATE' : 'UNSUPPORTED_TRANSITION',
    );
  }
  return to;
}
