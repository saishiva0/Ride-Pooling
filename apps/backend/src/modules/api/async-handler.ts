/**
 * Shared HTTP plumbing (Phase 3.10).
 *
 * Express 4 does not forward rejected promises to its error middleware, so
 * every async controller must be wrapped. This wrapper keeps controllers thin
 * and guarantees errors (AppError or unexpected) flow into the centralized
 * error handler — never an unhandled rejection or a bare stack trace.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async request handler so rejections are forwarded to `next()`,
 * where the centralized error handler maps them (see
 * `middleware/error-handler.ts`).
 */
export function asyncHandler(
  handler: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}
