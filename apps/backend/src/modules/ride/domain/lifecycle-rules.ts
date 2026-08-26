/**
 * Ride lifecycle domain rules for the creator flow (Phase 3.17 — PUBLISH /
 * START / COMPLETE).
 *
 * Pure predicates only — no I/O. Sources of truth:
 *
 * - `docs/domain/ride-lifecycle.md` §2.1 (DRAFT → PUBLISHED), §2.2
 *   (PUBLISHED → IN_PROGRESS), §2.3 (CONFIRMED → IN_PROGRESS), §2.4
 *   (IN_PROGRESS → COMPLETED), and §2.5–§2.7 (terminal states accept no
 *   transitions).
 * - `docs/domain/ride-engine.md` §4.1 (ride created in DRAFT) and §5
 *   invariant 8 (only the ride creator may change their ride).
 *
 * As with cancellation/expiration, these are thin, named wrappers over the
 * Phase 3.1 state machine (`canTransitionRideStatus`) so they can never
 * diverge from the documented lifecycle. The operations themselves must call
 * `transitionRideStatus` to produce the resulting state (never a direct
 * assignment).
 */
import { RideStatus } from '@prisma/client';
import { canTransitionRideStatus } from './ride-state-machine.js';

/**
 * Whether the ride status may be published (DRAFT → PUBLISHED,
 * `ride-lifecycle.md` §2.1).
 *
 * Deliberately NOT a blind "can reach PUBLISHED" check: the state machine
 * also allows CONFIRMED → PUBLISHED, but that is the documented AUTOMATIC
 * reversion when the last confirmed participant cancels (§2.3/§4.2) — not the
 * creator's publish operation. Publish is exactly DRAFT → PUBLISHED.
 */
export function canPublishRide(status: RideStatus): boolean {
  return (
    status === RideStatus.DRAFT &&
    canTransitionRideStatus(status, RideStatus.PUBLISHED)
  );
}

/**
 * Whether the ride status may be started (PUBLISHED | CONFIRMED →
 * IN_PROGRESS, `ride-lifecycle.md` §2.2/§2.3).
 */
export function canStartRide(status: RideStatus): boolean {
  return canTransitionRideStatus(status, RideStatus.IN_PROGRESS);
}

/**
 * Whether the ride status may be completed (IN_PROGRESS → COMPLETED,
 * `ride-lifecycle.md` §2.4).
 */
export function canCompleteRide(status: RideStatus): boolean {
  return canTransitionRideStatus(status, RideStatus.COMPLETED);
}
