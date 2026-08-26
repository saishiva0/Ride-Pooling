/**
 * Ride domain errors (Phase 3.1).
 *
 * Reuses the existing error foundation (`../../../lib/errors.ts`) instead of
 * introducing a new error architecture. Per
 * `docs/architecture/api-boundaries.md` §4 and
 * `docs/domain/ride-lifecycle.md` §7 ("illegal transitions are rejected
 * with a business rule violation error"), illegal state transitions map to
 * `BusinessRuleError` (422); malformed ride field values map to
 * `ValidationError` (400).
 */
import { BusinessRuleError, ValidationError } from '../../../lib/errors.js';
import type { RideStatus } from './ride.types.js';

/** Why a requested ride status transition was rejected. */
export type RideTransitionRejectionReason =
  'TERMINAL_STATE' | 'UNSUPPORTED_TRANSITION';

/**
 * Thrown by the ride state machine when a transition is not explicitly
 * allowed. Carries the current state, requested state, and reason so
 * callers/tests can assert on structure rather than message text.
 */
export class RideTransitionError extends BusinessRuleError {
  readonly currentState: RideStatus;
  readonly requestedState: RideStatus;
  readonly reason: RideTransitionRejectionReason;

  constructor(
    currentState: RideStatus,
    requestedState: RideStatus,
    reason: RideTransitionRejectionReason,
  ) {
    super(`Cannot transition ride from ${currentState} to ${requestedState}`, {
      field: 'status',
      details: { currentState, requestedState, reason },
    });
    this.name = 'RideTransitionError';
    this.currentState = currentState;
    this.requestedState = requestedState;
    this.reason = reason;
  }
}

/** Which ride domain rule was violated. */
export type RideFieldValidationReason =
  | 'SEATS_INVALID'
  | 'PRICE_INVALID'
  | 'LATITUDE_INVALID'
  | 'LONGITUDE_INVALID'
  | 'ORIGIN_DESTINATION_IDENTICAL';

/**
 * Thrown when a ride field fails Phase 3.1 domain validation (seats,
 * pricing, coordinates). Carries a machine-readable `reason` in addition to
 * the human-readable message.
 */
export class RideValidationError extends ValidationError {
  readonly reason: RideFieldValidationReason;

  constructor(
    message: string,
    reason: RideFieldValidationReason,
    options?: { field?: string; details?: Record<string, unknown> },
  ) {
    super(message, {
      field: options?.field,
      details: { ...options?.details, reason },
    });
    this.name = 'RideValidationError';
    this.reason = reason;
  }
}
