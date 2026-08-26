import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@ridepool/shared';
import { AppError, NotFoundError, toAppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

export interface ErrorHandlerOptions {
  logger: Logger;
  exposeStack: boolean;
}

/**
 * Centralized error-handling middleware.
 *
 * - AppErrors render their mapped code/status/message.
 * - Unexpected errors become INTERNAL_ERROR; in production the stack trace and
 *   internal message are never leaked to the client.
 */
export function createErrorHandler(options: ErrorHandlerOptions) {
  const { logger, exposeStack } = options;

  return function errorHandler(
    err: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
  ): void {
    const appErr = toAppError(err);

    if (!(err instanceof AppError)) {
      logger.error(
        { err, requestId: res.locals.requestId, path: req.path },
        'Unhandled error',
      );
    }

    const body: ApiErrorBody = {
      code: appErr.code,
      message: appErr.expose ? appErr.message : 'Internal server error',
    };
    if (appErr.field) {
      body.field = appErr.field;
    }
    if (appErr.details) {
      body.details = appErr.details;
    }

    const payload: Record<string, unknown> = { error: body };
    if (exposeStack && !appErr.expose) {
      payload.stack = appErr.stack;
    }

    res.status(appErr.statusCode).json(payload);
  };
}

export function notFoundHandler(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  // Unknown routes are a client error (404), not a server error — corrected
  // from the Phase 1 placeholder 500 when the /api/v1 boundary landed
  // (Phase 3.10 notes §10).
  next(new NotFoundError(`Route not found: ${req.method} ${req.path}`));
}
