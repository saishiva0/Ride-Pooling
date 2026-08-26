/**
 * Success envelope for versioned API responses (Phase 3.10).
 *
 * Every /api/v1 success response is `{ data: ... }`. The error envelope is
 * `ApiErrorResponse` (`contracts/error.ts`). The health endpoint is outside
 * the versioned namespace and returns its own body untouched.
 */
export interface ApiDataResponse<T> {
  data: T;
}
