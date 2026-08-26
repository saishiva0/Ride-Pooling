import type { ErrorCode } from '@ridepool/shared';

/**
 * Centralized error foundation.
 *
 * Maps to the API error model in `docs/architecture/api-boundaries.md` §4.
 * Business rules are NOT implemented in Phase 1; these types are the reusable
 * building blocks for later modules (auth, rides, matching, etc.).
 */

export interface AppErrorOptions {
  code: ErrorCode;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
  statusCode: number;
  cause?: unknown;
  expose: boolean;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly field?: string;
  readonly details?: Record<string, unknown>;
  readonly statusCode: number;
  readonly expose: boolean;

  constructor(opts: AppErrorOptions) {
    super(opts.message);
    this.name = 'AppError';
    this.code = opts.code;
    this.field = opts.field;
    this.details = opts.details;
    this.statusCode = opts.statusCode;
    this.expose = opts.expose;
    if (opts.cause !== undefined) {
      this.cause = opts.cause;
    }
  }
}

function makeError(code: ErrorCode, statusCode: number, expose: boolean) {
  return class extends AppError {
    constructor(
      message: string,
      opts?: {
        field?: string;
        details?: Record<string, unknown>;
        cause?: unknown;
      },
    ) {
      super({
        code,
        statusCode,
        expose,
        message,
        field: opts?.field,
        details: opts?.details,
        cause: opts?.cause,
      });
      this.name = `${code[0]}${code.slice(1).toLowerCase()}`;
    }
  };
}

export const ValidationError = makeError('VALIDATION_ERROR', 400, true);
export const AuthenticationError = makeError('AUTHENTICATION_ERROR', 401, true);
export const AuthorizationError = makeError('AUTHORIZATION_ERROR', 403, true);
export const NotFoundError = makeError('NOT_FOUND', 404, true);
export const ConflictError = makeError('CONFLICT', 409, true);
export const BusinessRuleError = makeError(
  'BUSINESS_RULE_VIOLATION',
  422,
  true,
);
export const RateLimitError = makeError('RATE_LIMITED', 429, true);
export const ExternalServiceError = makeError(
  'EXTERNAL_SERVICE_ERROR',
  502,
  false,
);
export const InternalError = makeError('INTERNAL_ERROR', 500, false);

/** Maps any thrown value to an AppError (defaults to INTERNAL_ERROR). */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }
  return new InternalError(
    err instanceof Error ? err.message : 'Internal server error',
    { cause: err },
  );
}
