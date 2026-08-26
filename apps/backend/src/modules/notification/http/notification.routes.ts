/**
 * Notification HTTP routes (Phase 3.10).
 *
 * Canonical paths from `docs/development/phase-3-10-notes.md` §3. All
 * endpoints are authenticated (`requireAuth`) — a user can only ever reach
 * their own notifications. No business logic lives here.
 */
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { asyncHandler } from '../../api/async-handler.js';
import {
  listNotificationsHandler,
  markAllNotificationsAsReadHandler,
  markNotificationAsReadHandler,
} from './notification.controller.js';

export interface NotificationRouterOptions {
  /** The authentication middleware produced by `createAuthMiddleware`. */
  requireAuth: RequestHandler;
}

export function createNotificationRouter(
  options: NotificationRouterOptions,
): Router {
  const { requireAuth } = options;
  const router = Router();

  router.get(
    '/notifications',
    requireAuth,
    asyncHandler(listNotificationsHandler),
  );
  router.patch(
    '/notifications/:notificationId/read',
    requireAuth,
    asyncHandler(markNotificationAsReadHandler),
  );
  router.patch(
    '/notifications/read-all',
    requireAuth,
    asyncHandler(markAllNotificationsAsReadHandler),
  );

  return router;
}
