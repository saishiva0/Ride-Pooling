/**
 * Ride request / participation cancellation domain rules (Phase 3.21).
 *
 * Pure predicates and constants only — no I/O. Source of truth:
 * `docs/domain/ride-lifecycle.md` §4.2 and §6.
 *
 *   - `PENDING` request  → the participant may WITHDRAW the request; the ride
 *     state is unchanged (no seat was ever allocated for a PENDING request).
 *   - `ACCEPTED` request → the participant may CANCEL their participation:
 *     the seat is freed (participant → CANCELLED), the request → CANCELLED,
 *     and when the LAST confirmed participant cancels, the ride reverts
 *     `CONFIRMED → PUBLISHED`.
 *   - Ride `IN_PROGRESS` → participation cancellation is NOT permitted
 *     (`ride-lifecycle.md` §4.2, referencing OD-011).
 *
 * No product decision is resolved here: OD-002 (time-based cancellation
 * windows / grace periods) remains OPEN — the rules below are purely
 * state-based, matching the canonical Phase 3.5/3.7 baseline ("no time
 * window, by design").
 */
import { RideRequestStatus, RideStatus } from '@prisma/client';

/**
 * Whether a request may be withdrawn by its requester.
 *
 * Only a `PENDING` request is withdrawable — an `ACCEPTED` request has
 * already created a participant and requires the participation-cancellation
 * path instead; `REJECTED`/`CANCELLED` are historical
 * (`docs/domain/ride-lifecycle.md` §6). Withdrawal is purely a request-state
 * rule: it never depends on the ride state (withdrawing a PENDING request
 * changes nothing about the ride itself).
 */
export function isWithdrawableRequest(status: RideRequestStatus): boolean {
  return status === RideRequestStatus.PENDING;
}

/**
 * Whether an ACCEPTED participation may be cancelled by its participant.
 *
 * The request must be `ACCEPTED` (a participant exists) AND the ride must not
 * be `IN_PROGRESS` (`docs/domain/ride-lifecycle.md` §4.2 — participation
 * cancellation is not permitted once the ride is underway; see OD-011). A
 * terminal ride state does not block this: cancel on an already-terminal ride
 * is harmless (no seat was or can be used) and merely records the
 * participant's departure.
 */
export function isCancellableParticipation(args: {
  requestStatus: RideRequestStatus;
  rideStatus: RideStatus;
}): boolean {
  return (
    args.requestStatus === RideRequestStatus.ACCEPTED &&
    args.rideStatus !== RideStatus.IN_PROGRESS
  );
}

/**
 * Whether cancelling the last confirmed participant reverts the ride to
 * PUBLISHED. Only a `CONFIRMED` ride may be reverted (the state machine
 * already allows `CONFIRMED → PUBLISHED`; `ride-lifecycle.md` §2.3/§4.2).
 * When `remainingConfirmedSeats === 0` no confirmed participant remains.
 */
export function shouldRevertToPublished(args: {
  rideStatus: RideStatus;
  remainingConfirmedSeats: number;
}): boolean {
  return (
    args.rideStatus === RideStatus.CONFIRMED &&
    args.remainingConfirmedSeats === 0
  );
}
