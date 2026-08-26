/**
 * Notification HTTP controllers (Phase 3.10).
 *
 * Thin by construction: read the request, read the authenticated identity,
 * parse HTTP input with Zod, call ONE existing application service, and
 * envelope the result. No Prisma, no repositories, no notification logic.
 * The recipient id always comes from the authentication boundary — never a
 * body/query value. Ownership is enforced by the application services (and
 * the Phase 3.9 authorization rules); errors are handled centrally.
 */
import type { Request, Response } from 'express';
import { getAuthenticatedUser } from '../../auth/http/auth.middleware.js';
import { parseRequest } from '../../api/parse.js';
import { sendData } from '../../api/response.js';
import { listNotifications } from '../application/list-notifications.js';
import { markNotificationAsRead } from '../application/mark-notification-as-read.js';
import { markAllNotificationsAsRead } from '../application/mark-all-notifications-as-read.js';
import {
  listNotificationsQuerySchema,
  notificationIdPathSchema,
} from './notification.schemas.js';

/** GET /api/v1/notifications — the authenticated user's notifications. */
export async function listNotificationsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const query = parseRequest(listNotificationsQuerySchema, req.query);

  const result = await listNotifications({
    userId: identity.userId,
    limit: query.limit,
  });
  sendData(res, 200, result);
}

/** PATCH /api/v1/notifications/:notificationId/read — owner only. */
export async function markNotificationAsReadHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const { notificationId } = parseRequest(notificationIdPathSchema, req.params);

  const result = await markNotificationAsRead({
    notificationId,
    userId: identity.userId,
  });
  sendData(res, 200, result);
}

/** PATCH /api/v1/notifications/read-all — the authenticated user's unread. */
export async function markAllNotificationsAsReadHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);

  const result = await markAllNotificationsAsRead({
    userId: identity.userId,
  });
  sendData(res, 200, result);
}
