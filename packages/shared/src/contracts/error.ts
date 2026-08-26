/**
 * Shared API error codes. Used by the backend error model and by the mobile
 * API client for error normalization (see `docs/architecture/api-boundaries.md`
 * §4 Error Model).
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  RATE_LIMITED: 'RATE_LIMITED',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}
