/**
 * Mark-one-notification-as-read use case (Phase 3.8).
 *
 * Marks a single notification read, but only for its owner. Missing
 * notifications throw `NotFoundError`; a notification owned by someone else
 * throws `AuthorizationError` (no user may mark another user's notification
 * read). Already-read notifications are idempotent: the call returns the
 * current state WITHOUT modifying `readAt`.
 *
 * Flow (all inside one transaction):
 *
 *   validate input shape
 *   → load the notification (missing → NotFoundError)
 *   → owner check (notification.userId !== userId → AuthorizationError)
 *   → already read → return unchanged (no write)
 *   → updateMany(id + userId + readAt IS NULL) → return updated state
 */
import {
  AppError,
  AuthorizationError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import {
  defaultNotificationDependencies,
  toAppNotification,
  type AppNotification,
  type NotificationDependencies,
} from './notification-dependencies.js';

/** The trusted input for marking a single notification read. */
export interface MarkNotificationAsReadInput {
  notificationId: string;
  /** The user performing the action (must own the notification). */
  userId: string;
}

/**
 * Marks one notification read for its owner.
 *
 * Throws `ValidationError` (malformed input), `NotFoundError` (missing
 * notification), `AuthorizationError` (not the owner), or `InternalError`
 * (unexpected persistence failure).
 */
export async function markNotificationAsRead(
  input: MarkNotificationAsReadInput,
  deps: Partial<NotificationDependencies> = {},
): Promise<AppNotification> {
  const { runTransaction } = {
    ...defaultNotificationDependencies(),
    ...deps,
  };

  if (
    typeof input.notificationId !== 'string' ||
    input.notificationId.trim() === ''
  ) {
    throw new ValidationError('notificationId is required', {
      field: 'notificationId',
    });
  }
  if (typeof input.userId !== 'string' || input.userId.trim() === '') {
    throw new ValidationError('userId is required', { field: 'userId' });
  }

  return runTransaction(async (persistence) => {
    const record = await persistence.findNotificationById(input.notificationId);
    if (!record) {
      throw new NotFoundError('Notification not found', {
        field: 'notificationId',
        details: { notificationId: input.notificationId },
      });
    }

    if (record.userId !== input.userId) {
      throw new AuthorizationError(
        'Only the notification recipient can mark it as read',
        {
          field: 'userId',
          details: { notificationId: input.notificationId },
        },
      );
    }

    if (record.readAt !== null) {
      // Idempotent: already read — return current state, no write.
      return toAppNotification(record);
    }

    try {
      const readAt = new Date();
      await persistence.markNotificationRead({
        id: record.id,
        userId: input.userId,
        readAt,
      });
      return toAppNotification({ ...record, readAt });
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new InternalError('Failed to mark notification as read', {
        cause: err,
      });
    }
  });
}
