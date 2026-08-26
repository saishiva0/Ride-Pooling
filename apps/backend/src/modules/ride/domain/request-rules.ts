/**
 * Ride request domain rules (Phase 3.5 — RIDE REQUESTS).
 *
 * Pure predicates and constants only — no I/O. Sources of truth:
 *
 * - `docs/domain/ride-lifecycle.md` §6 (request state machine) and §2.2/§2.3
 *   (which ride states accept requests).
 * - `docs/domain/ride-engine.md` §4.7 (request creation validation) and §5
 *   invariants 5 and 10.
 * - `docs/domain/domain-model.md` §2.3 (requestedSeats ≥ 1, default 1).
 * - The Phase 2 migration (partial unique index `RideRequest_active_unique`
 *   WHERE status IN ('PENDING','ACCEPTED')), which defines which request
 *   statuses count as "active" for duplicate prevention.
 *
 * No product decision is resolved here (OD-002 request/expiration windows
 * remain OPEN — no time-based cutoff is introduced).
 */
import { RideRequestStatus, RideStatus } from '@prisma/client';

/**
 * Ride states that accept join requests.
 *
 * `docs/domain/ride-lifecycle.md`: `PUBLISHED` is "open to join requests"
 * (§2.2) and `CONFIRMED` still allows requests "while seats remain" (§2.3).
 * `IN_PROGRESS` accepts no new requests (§2.4); `DRAFT` and terminal states
 * (`COMPLETED`/`CANCELLED`/`EXPIRED`) never accept requests. Seat
 * availability is validated separately (a `CONFIRMED` ride with no free
 * seats is not requestable).
 */
export const REQUESTABLE_RIDE_STATUSES: readonly RideStatus[] = [
  RideStatus.PUBLISHED,
  RideStatus.CONFIRMED,
];

/**
 * Request statuses that count as "active" for duplicate prevention.
 *
 * Mirrors the Phase 2 partial unique index `RideRequest_active_unique`
 * (WHERE status IN ('PENDING','ACCEPTED')). A `REJECTED`/`CANCELLED` request
 * is historical and does not block a new request.
 */
export const ACTIVE_REQUEST_STATUSES: readonly RideRequestStatus[] = [
  RideRequestStatus.PENDING,
  RideRequestStatus.ACCEPTED,
];

/** Minimum requested seat count (`docs/domain/domain-model.md` §2.3). */
export const MIN_REQUESTED_SEATS = 1;

/** Requested seats must be a positive integer (≥ 1). */
export function isValidRequestedSeats(requestedSeats: number): boolean {
  return (
    Number.isInteger(requestedSeats) && requestedSeats >= MIN_REQUESTED_SEATS
  );
}

/** Whether the ride status currently accepts join requests. */
export function isRequestableRideStatus(status: RideStatus): boolean {
  return REQUESTABLE_RIDE_STATUSES.includes(status);
}

/**
 * Whether the ride has enough currently available seats for the requested
 * count. This is a validation against the live ride state (read inside the
 * creation transaction) — it does NOT reserve or mutate seats (seat
 * allocation happens at acceptance; `docs/domain/ride-engine.md` §4.8).
 */
export function hasSufficientSeats(
  requestedSeats: number,
  availableSeats: number,
): boolean {
  return availableSeats >= requestedSeats;
}
