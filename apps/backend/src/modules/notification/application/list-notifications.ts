/**
 * Notification listing use case (Phase 3.8).
 *
 * Lists a recipient's notifications, newest first, with an unread count. The
 * listing is deterministic (`createdAt DESC`, `id DESC` tiebreak) and supports
 * an optional limit with a `hasMore` flag (a simple, efficient `limit + 1`
 * probe — no cursor pagination, matching the architecture's lack of a
 * pagination convention).
 */
import { ValidationError } from '../../../lib/errors.js';
import {
  defaultNotificationDependencies,
  toAppNotification,
  type AppNotification,
  type NotificationDependencies,
} from './notification-dependencies.js';

/** Default page size when no limit is supplied. */
export const DEFAULT_NOTIFICATION_LIMIT = 50;

/** The trusted input for listing a recipient's notifications. */
export interface ListNotificationsInput {
  /** The user whose notifications are being listed. */
  userId: string;
  /** Optional maximum number of rows; defaults to 50. */
  limit?: number;
}

/** A page of notifications for a recipient. */
export interface NotificationListResult {
  notifications: AppNotification[];
  /** The recipient's total unread count (independent of this page). */
  unreadCount: number;
  /** True when more notifications exist beyond the returned page. */
  hasMore: boolean;
}

/**
 * Lists a recipient's notifications newest first.
 *
 * Throws `ValidationError` for malformed input (empty userId, non-positive or
 * non-integer limit).
 */
export async function listNotifications(
  input: ListNotificationsInput,
  deps: Partial<NotificationDependencies> = {},
): Promise<NotificationListResult> {
  const { runTransaction } = {
    ...defaultNotificationDependencies(),
    ...deps,
  };

  if (typeof input.userId !== 'string' || input.userId.trim() === '') {
    throw new ValidationError('userId is required', { field: 'userId' });
  }
  const limit = input.limit ?? DEFAULT_NOTIFICATION_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ValidationError('limit must be a positive integer', {
      field: 'limit',
      details: { limit },
    });
  }

  return runTransaction(async (persistence) => {
    const [rows, unreadCount] = await Promise.all([
      persistence.listNotifications({ userId: input.userId, limit: limit + 1 }),
      persistence.countUnreadNotifications(input.userId),
    ]);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      notifications: page.map(toAppNotification),
      unreadCount,
      hasMore,
    };
  });
}
