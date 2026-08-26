/**
 * Ride cancellation domain rules (Phase 3.7 — CANCELLATION).
 *
 * Pure predicates only — no I/O. Sources of truth:
 *
 * - `docs/domain/ride-lifecycle.md` §2.1/§2.2/§2.3/§2.4 (a ride may be
 *   cancelled by its creator from `DRAFT`, `PUBLISHED`, `CONFIRMED`, or
 *   `IN_PROGRESS`) and §2.5–§2.7 (terminal states `COMPLETED`/`CANCELLED`/
 *   `EXPIRED` accept no transitions).
 * - `docs/domain/ride-engine.md` §4.10 (creator cancellation per lifecycle)
 *   and §5 invariant 8 (only the ride creator may cancel their ride).
 *
 * The transition logic is deliberately NOT duplicated: `canCancelRide` is a
 * thin, named wrapper over the Phase 3.1 state machine
 * (`canTransitionRideStatus(status, CANCELLED)`), which already encodes
 * exactly these four cancellable source states. The cancellation operation
 * itself must call `transitionRideStatus` to produce the resulting state
 * (Phase 3.7 §4).
 */
import { RideStatus } from '@prisma/client';
import { canTransitionRideStatus } from './ride-state-machine.js';

/**
 * Whether the ride status may be cancelled.
 *
 * Delegates to the state machine, so this can never diverge from the
 * documented lifecycle: `DRAFT`/`PUBLISHED`/`CONFIRMED`/`IN_PROGRESS` →
 * `CANCELLED` are allowed; `COMPLETED`/`CANCELLED`/`EXPIRED` are not.
 */
export function canCancelRide(status: RideStatus): boolean {
  return canTransitionRideStatus(status, RideStatus.CANCELLED);
}
