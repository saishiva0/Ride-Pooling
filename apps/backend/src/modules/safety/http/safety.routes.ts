/**
 * Safety HTTP routes (Phase 3.24 — Reporting & Blocking).
 *
 * Every endpoint is authenticated (`requireAuth`); no business logic lives
 * here — routes only wire middleware to thin controllers, matching the
 * `ride`/`notification`/device-token routing convention.
 */
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { asyncHandler } from '../../api/async-handler.js';
import {
  createBlockHandler,
  createReportHandler,
  listMyBlocksHandler,
  listMyReportsHandler,
  removeBlockHandler,
} from './safety.controller.js';

export interface SafetyRouterOptions {
  /** The authentication middleware produced by `createAuthMiddleware`. */
  requireAuth: RequestHandler;
}

export function createSafetyRouter(options: SafetyRouterOptions): Router {
  const { requireAuth } = options;
  const router = Router();

  router.post('/reports', requireAuth, asyncHandler(createReportHandler));
  router.get('/reports/mine', requireAuth, asyncHandler(listMyReportsHandler));

  router.post('/blocks', requireAuth, asyncHandler(createBlockHandler));
  router.get('/blocks/mine', requireAuth, asyncHandler(listMyBlocksHandler));
  router.delete(
    '/blocks/:blockedUserId',
    requireAuth,
    asyncHandler(removeBlockHandler),
  );

  return router;
}
