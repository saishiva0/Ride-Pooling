/**
 * Mark-all-notifications-as-read use case (Phase 3.8).
 *
 * Marks every unread notification of a recipient as read in a single
 * efficient operation. Already-read notifications are never modified (the
 * `readAt IS NULL` predicate), so the operation is naturally idempotent and
 * returns the number of notifications actually updated.
 */
import { ValidationError } from '../../../lib/errors.js';
import {
  defaultNotificationDependencies,
  type NotificationDependencies,
} from './notification-dependencies.js';

/** The trusted input for marking all notifications read. */
export interface MarkAllNotificationsAsReadInput {
  /** The user whose unread notifications are being marked read. */
  userId: string;
}

/** The result of a mark-all operation. */
export interface MarkAllNotificationsAsReadResult {
  /** The number of notifications transitioned from unread → read. */
  updatedCount: number;
}

/**
 * Marks all of a recipient's unread notifications read.
 *
 * Throws `ValidationError` for malformed input (empty userId). An unknown user
 * is a successful no-op (`updatedCount: 0`).
 */
export async function markAllNotificationsAsRead(
  input: MarkAllNotificationsAsReadInput,
  deps: Partial<NotificationDependencies> = {},
): Promise<MarkAllNotificationsAsReadResult> {
  const { runTransaction } = {
    ...defaultNotificationDependencies(),
    ...deps,
  };

  if (typeof input.userId !== 'string' || input.userId.trim() === '') {
    throw new ValidationError('userId is required', { field: 'userId' });
  }

  return runTransaction(async (persistence) => {
    const { count } = await persistence.markAllNotificationsRead({
      userId: input.userId,
      readAt: new Date(),
    });
    return { updatedCount: count };
  });
}
