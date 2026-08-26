/**
 * Shared HTTP plumbing (Phase 3.10): success envelope.
 *
 * Every /api/v1 success response is `{ data: ... }` (shared contract
 * `ApiDataResponse`); errors use the existing `{ error: ... }` envelope from
 * the centralized error handler. This helper is the ONLY place that shapes
 * success responses, so the format cannot drift between controllers.
 */
import type { Response } from 'express';
import type { ApiDataResponse } from '@ridepool/shared';

/** Sends `data` wrapped in the standard success envelope. */
export function sendData<T>(res: Response, statusCode: number, data: T): void {
  const body: ApiDataResponse<T> = { data };
  res.status(statusCode).json(body);
}
