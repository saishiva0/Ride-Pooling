import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Logger } from '../lib/logger.js';

export interface RequestContext {
  requestId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      requestId?: string;
    }
  }
}

/**
 * Assigns a request id and basic per-request logging. The request id is
 * available on `res.locals.requestId` for correlation in logs and errors.
 */
export function requestContext(logger: Logger) {
  return function requestContextMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    logger.debug(
      { requestId, method: req.method, path: req.path },
      'request start',
    );

    const startedAt = Date.now();
    res.on('finish', () => {
      logger.info(
        {
          requestId,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
        },
        'request complete',
      );
    });

    next();
  };
}
