/**
 * Normalized mobile error model (Phase 3.13 — MOBILE FOUNDATION, §16).
 *
 * Application code never receives raw fetch/transport errors or raw backend
 * payloads: everything is normalized to a `MobileError` with a machine-
 * readable `kind`. Stack traces and raw transport internals are never exposed
 * to the UI.
 *
 * The `kind` taxonomy covers the documented failure classes: network failure,
 * timeout, API/validation errors, authentication, authorization, not found,
 * conflict, business-rule failure, and unknown/server failure. Backend error
 * codes (the shared `ErrorCode` contract from `@ridepool/shared`) map
 * deterministically to kinds — this is transport-aware but business-logic-
 * light: no backend business rules are duplicated here.
 *
 * Phase 3.16 adds the device-location kinds (`permission-denied`,
 * `permission-unavailable`, `location-unavailable`) so the location boundary
 * reuses the SAME normalized model instead of a second error hierarchy; they
 * are produced only by the mobile location layer and never by API responses.
 */
import type { ApiErrorBody, ErrorCode } from '@ridepool/shared';

export type MobileErrorKind =
  | 'network'
  | 'timeout'
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'not-found'
  | 'conflict'
  | 'business-rule'
  | 'rate-limited'
  | 'external-service'
  | 'permission-denied'
  | 'permission-unavailable'
  | 'location-unavailable'
  | 'server'
  | 'unknown';

/** Maps the shared backend error codes to normalized kinds. */
const CODE_TO_KIND: Record<ErrorCode, MobileErrorKind> = {
  VALIDATION_ERROR: 'validation',
  AUTHENTICATION_ERROR: 'authentication',
  AUTHORIZATION_ERROR: 'authorization',
  NOT_FOUND: 'not-found',
  CONFLICT: 'conflict',
  BUSINESS_RULE_VIOLATION: 'business-rule',
  RATE_LIMITED: 'rate-limited',
  EXTERNAL_SERVICE_ERROR: 'external-service',
  INTERNAL_ERROR: 'server',
};

export class MobileError extends Error {
  readonly kind: MobileErrorKind;
  /** HTTP status when the error came from an HTTP response. */
  readonly statusCode?: number;
  /** Backend error code when the error came from the API error envelope. */
  readonly code?: ErrorCode;
  /** Backend-provided field path (validation/business-rule errors). */
  readonly field?: string;
  /** Backend-provided structured details (never stack traces). */
  readonly details?: Record<string, unknown>;

  constructor(
    kind: MobileErrorKind,
    message: string,
    options: {
      statusCode?: number;
      code?: ErrorCode;
      field?: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'MobileError';
    this.kind = kind;
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.field = options.field;
    this.details = options.details;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/**
 * Builds a `MobileError` from the shared API error envelope body. The HTTP
 * status is carried when known (it is not part of the envelope itself).
 */
export function apiErrorFromBody(
  body: ApiErrorBody,
  statusCode?: number,
): MobileError {
  return new MobileError(CODE_TO_KIND[body.code] ?? 'unknown', body.message, {
    statusCode,
    code: body.code,
    field: body.field,
    details: body.details,
  });
}

/**
 * Normalizes any thrown value into a `MobileError`. Transport failures are
 * classified here; anything unrecognized becomes a generic 'unknown' error.
 * Never re-thrown raw.
 */
export function toMobileError(err: unknown): MobileError {
  if (err instanceof MobileError) {
    return err;
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return new MobileError('timeout', 'Request timed out', { cause: err });
  }
  if (err instanceof TypeError) {
    return new MobileError('network', 'Network request failed', { cause: err });
  }
  return new MobileError('unknown', 'Unexpected error', { cause: err });
}

/**
 * The user-facing message for a normalized error (Phase 3.15). Backend-authored
 * messages are surfaced only for `validation` and `business-rule` errors (both
 * are human-readable by contract); every other kind maps to a stable generic
 * message so raw transport/server detail never reaches the UI.
 */
export function mobileErrorMessage(error: MobileError): string {
  switch (error.kind) {
    case 'validation':
    case 'business-rule':
      return error.message || 'The request could not be completed.';
    case 'network':
      return 'Network request failed. Check your connection and try again.';
    case 'timeout':
      return 'The request timed out. Try again.';
    case 'authentication':
      return 'Authentication failed. Sign in again.';
    case 'authorization':
      return 'You do not have permission to do this.';
    case 'not-found':
      return 'Not found.';
    case 'conflict':
      return 'This action conflicts with the current state. Refresh and try again.';
    case 'rate-limited':
      return 'Too many requests. Try again shortly.';
    case 'external-service':
      return 'A service is temporarily unavailable. Try again.';
    case 'permission-denied':
      return 'Location permission was denied. You can still enter coordinates manually.';
    case 'permission-unavailable':
      return 'Location permission is not available on this device. You can still enter coordinates manually.';
    case 'location-unavailable':
      return 'Your current location could not be determined. You can still enter coordinates manually.';
    case 'server':
      return 'The server encountered an error. Try again.';
    default:
      return 'Something went wrong. Try again.';
  }
}
