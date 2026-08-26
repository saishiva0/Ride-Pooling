/**
 * Ride expiration domain rules (Phase 3.7 — EXPIRATION).
 *
 * Pure predicates only — no I/O, no wall-clock reads. Sources of truth:
 *
 * - `docs/domain/ride-lifecycle.md` §2.7 (a `PUBLISHED` ride whose departure
 *   datetime has passed may expire) and §5 (expiration candidate: `now >
 *   departure_datetime + grace_window` AND the ride has not started;
 *   `CONFIRMED` rides are NOT auto-expired).
 * - `docs/domain/ride-engine.md` §4.11 (only `PUBLISHED` rides may expire).
 *
 * The exact grace window is a PRODUCT DECISION REQUIRED (OD-002, still OPEN
 * — see `docs/planning/open-decisions.md`). This module therefore separates
 * the eligibility *logic* (which state may expire, and whether the departure
 * window has passed) from the *policy* (the grace window value), which is
 * supplied by the caller as an explicit argument — never hardcoded here.
 *
 * Reference time is injected (`referenceTime`), so time-dependent behaviour
 * is deterministic and testable with fixed timestamps.
 */
import { RideStatus } from '@prisma/client';

/**
 * Ride states eligible for expiration.
 *
 * Only `PUBLISHED` (`ride-lifecycle.md` §2.7/§5: a published ride whose
 * departure passes without starting; `CONFIRMED` rides are explicitly NOT
 * auto-expired, `ride-lifecycle.md` §5). `DRAFT` has not been published,
 * `IN_PROGRESS` has started, and the terminal states must not expire.
 */
export const EXPIRABLE_RIDE_STATUSES: readonly RideStatus[] = [
  RideStatus.PUBLISHED,
];

/** Whether the ride status may be expired (only `PUBLISHED`). */
export function isExpirableRideStatus(status: RideStatus): boolean {
  return EXPIRABLE_RIDE_STATUSES.includes(status);
}

/**
 * Whether the departure window has passed at `referenceTime`.
 *
 * The documented candidate rule is `now > departure_datetime + grace_window`
 * (`ride-lifecycle.md` §5). The grace window is OD-002 policy supplied by the
 * caller (baseline 0 — expire as soon as the departure datetime has passed);
 * it is never chosen here.
 */
export function hasDeparturePassed(
  referenceTime: Date,
  departureDateTime: Date,
  graceWindowMs: number,
): boolean {
  return referenceTime.getTime() > departureDateTime.getTime() + graceWindowMs;
}

/**
 * Composable expiration predicate over the authoritative, freshly read ride
 * state. The application service asserts status and departure-window
 * eligibility against the locked ride row; this predicate is the single
 * combined check for decision logic/tests.
 */
export function canExpireRide(args: {
  status: RideStatus;
  departureDateTime: Date;
  referenceTime: Date;
  graceWindowMs: number;
}): boolean {
  return (
    isExpirableRideStatus(args.status) &&
    hasDeparturePassed(
      args.referenceTime,
      args.departureDateTime,
      args.graceWindowMs,
    )
  );
}
