/**
 * Device token HTTP routes (Phase 3.23).
 *
 * Canonical paths for device push token management. All endpoints are
 * authenticated — a user can only ever manage their own tokens.
 */
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { asyncHandler } from '../../api/async-handler.js';
import {
  registerDeviceTokenHandler,
  deactivateDeviceTokenHandler,
  deactivateAllDeviceTokensHandler,
  listDeviceTokensHandler,
} from './device-token.controller.js';

export interface DeviceTokenRouterOptions {
  requireAuth: RequestHandler;
}

export function createDeviceTokenRouter(
  options: DeviceTokenRouterOptions,
): Router {
  const { requireAuth } = options;
  const router = Router();

  router.post(
    '/notifications/device-tokens',
    requireAuth,
    asyncHandler(registerDeviceTokenHandler),
  );

  router.get(
    '/notifications/device-tokens',
    requireAuth,
    asyncHandler(listDeviceTokensHandler),
  );

  router.delete(
    '/notifications/device-tokens',
    requireAuth,
    asyncHandler(deactivateAllDeviceTokensHandler),
  );

  router.delete(
    '/notifications/device-tokens/:token',
    requireAuth,
    asyncHandler(deactivateDeviceTokenHandler),
  );

  return router;
}
