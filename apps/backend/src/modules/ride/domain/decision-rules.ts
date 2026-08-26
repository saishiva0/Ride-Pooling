/**
 * Ride request decision domain rules (Phase 3.6 — ACCEPT / REJECT).
 *
 * Pure predicates and constants only — no I/O. Sources of truth:
 *
 * - `docs/domain/ride-lifecycle.md` §6 (request state machine:
 *   `PENDING ──creator accepts──▶ ACCEPTED`, `PENDING ──creator rejects──▶
 *   REJECTED`) and §2.2/§2.3 (PUBLISHED → CONFIRMED on the first accepted
 *   request; CONFIRMED stays open while seats remain).
 * - `docs/domain/ride-lifecycle.md` §6 ("ACCEPTED requests create a
 *   RideParticipant (status CONFIRMED)"), `docs/domain/domain-model.md` §2.4
 *   (participant status CONFIRMED/CANCELLED).
 * - `docs/domain/ride-engine.md` §5 invariant 12 (acceptance only when seats
 *   are available, atomically).
 *
 * Rules that already exist elsewhere are reused, not duplicated:
 * `REQUESTABLE_RIDE_STATUSES` / `hasSufficientSeats` come from
 * `domain/request-rules.ts` (acceptance eligibility == requestability — the
 * same ride states accept requests and decisions).
 */
import {
  ParticipantStatus,
  RideRequestStatus,
  RideStatus,
} from '@prisma/client';
import {
  hasSufficientSeats,
  REQUESTABLE_RIDE_STATUSES,
} from './request-rules.js';

/**
 * The initial RideParticipant status, set when a PENDING request is accepted
 * (`docs/domain/ride-lifecycle.md` §6: status `CONFIRMED`).
 */
export const INITIAL_PARTICIPANT_STATUS: ParticipantStatus =
  ParticipantStatus.CONFIRMED;

/** Whether the request is in the only decision-eligible state (PENDING). */
export function isPendingRequest(status: RideRequestStatus): boolean {
  return status === RideRequestStatus.PENDING;
}

/**
 * Whether the ride status permits accepting requests.
 *
 * Identical to requestability (`REQUESTABLE_RIDE_STATUSES` = PUBLISHED /
 * CONFIRMED): acceptance is the mirror of request creation. A `PUBLISHED`
 * ride accepts its first request (and transitions to CONFIRMED); a
 * `CONFIRMED` ride keeps accepting while seats remain.
 * (`docs/domain/ride-lifecycle.md` §2.2/§2.3.)
 */
export function isAcceptableRideStatus(status: RideStatus): boolean {
  return REQUESTABLE_RIDE_STATUSES.includes(status);
}

/**
 * Whether the ride currently has enough free seats for the request.
 *
 * Available = total − confirmed allocated seats, the exact live formula used
 * by discovery and request creation (`docs/domain/ride-engine.md` §4.8).
 */
export function hasAvailableSeats(
  requestedSeats: number,
  confirmedSeats: number,
  totalSeats: number,
): boolean {
  return hasSufficientSeats(requestedSeats, totalSeats - confirmedSeats);
}

/**
 * Composable acceptance predicate over the authoritative, freshly read state
 * (request status, ride status, seat usage). The application service asserts
 * each precondition individually so it can report a precise error; this
 * predicate is the single combined check for decision logic/tests.
 */
export function canAcceptRequest(args: {
  requestStatus: RideRequestStatus;
  rideStatus: RideStatus;
  requestedSeats: number;
  confirmedSeats: number;
  totalSeats: number;
}): boolean {
  return (
    isPendingRequest(args.requestStatus) &&
    isAcceptableRideStatus(args.rideStatus) &&
    hasAvailableSeats(args.requestedSeats, args.confirmedSeats, args.totalSeats)
  );
}

/**
 * Composable rejection predicate: only a PENDING request may be rejected
 * (`docs/domain/ride-lifecycle.md` §6).
 */
export function canRejectRequest(status: RideRequestStatus): boolean {
  return isPendingRequest(status);
}
