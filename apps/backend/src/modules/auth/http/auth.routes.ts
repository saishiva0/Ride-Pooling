/**
 * Auth HTTP routes (OD-005 — Phase 3.18).
 *
 * Public endpoints: `request-otp` and `verify-otp` (no session yet).
 * Protected endpoints: `me` and `logout` (require a valid session).
 */
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { asyncHandler } from '../../api/async-handler.js';
import { createAuthController } from './auth.controller.js';
import type { AuthDependencies } from '../application/auth-dependencies.js';

export interface AuthRouterOptions {
  /** The authentication middleware produced by `createAuthMiddleware`. */
  requireAuth: RequestHandler;
  /** Injected auth dependencies (tests inject fakes). */
  deps: AuthDependencies;
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const { requireAuth, deps } = options;
  const controller = createAuthController(deps);
  const router = Router();

  router.post('/auth/request-otp', asyncHandler(controller.requestOtp));
  router.post('/auth/verify-otp', asyncHandler(controller.verifyOtp));
  router.get('/auth/me', requireAuth, asyncHandler(controller.me));
  router.post('/auth/logout', requireAuth, asyncHandler(controller.logout));

  return router;
}
