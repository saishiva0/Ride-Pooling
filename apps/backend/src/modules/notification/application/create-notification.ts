/**
 * Notification creation use case (Phase 3.8).
 *
 * The generic, standalone way to create a notification for a user. Ride Engine
 * operations do NOT use this service (they write notifications inside their
 * own transaction via the notification mapping layer); this service is the
 * application-level create for direct/programmatic use, with recipient
 * validation and centralized content defaults.
 *
 * Flow (all inside one transaction):
 *
 *   validate input shape
 *   → type must be a supported NotificationType (else ValidationError)
 *   → recipient must exist (else NotFoundError)
 *   → derive title/body from the centralized content mapping when omitted
 *   → insert (FK races → NotFoundError; never a raw Prisma error)
 *   → typed result
 */
import { NotificationType } from '@prisma/client';
import {
  AppError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import { isSupportedNotificationType } from '../domain/notification-rules.js';
import { notificationContent } from './notification-content.js';
import {
  defaultNotificationDependencies,
  toAppNotification,
  type AppNotification,
  type NotificationDependencies,
} from './notification-dependencies.js';

/** The trusted input for creating a notification. */
export interface CreateNotificationInput {
  /** The user who should receive the notification. */
  recipientId: string;
  type: NotificationType;
  /** Optional override; defaults to the centralized content for the type. */
  title?: string;
  /** Optional override; defaults to the centralized content for the type. */
  body?: string;
  /** Optional ride context reference. */
  rideId?: string;
  /** Optional request context reference. */
  requestId?: string;
}

/** Application-level input shape checks for notification creation. */
function assertValidCreateInput(input: CreateNotificationInput): void {
  if (
    typeof input.recipientId !== 'string' ||
    input.recipientId.trim() === ''
  ) {
    throw new ValidationError('recipientId is required', {
      field: 'recipientId',
    });
  }
  if (!isSupportedNotificationType(input.type)) {
    throw new ValidationError('Unsupported notification type', {
      field: 'type',
      details: { type: input.type },
    });
  }
  for (const [key, value] of [
    ['title', input.title],
    ['body', input.body],
  ] as const) {
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.trim() === '')
    ) {
      throw new ValidationError(`${key} must be a non-empty string`, {
        field: key,
      });
    }
  }
  for (const [key, value] of [
    ['rideId', input.rideId],
    ['requestId', input.requestId],
  ] as const) {
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.trim() === '')
    ) {
      throw new ValidationError(`${key} must be a non-empty string`, {
        field: key,
      });
    }
  }
}

/**
 * Creates a notification for a user.
 *
 * Throws `ValidationError` (malformed input / unsupported type),
 * `NotFoundError` (missing recipient, or an FK race), or `InternalError`
 * (unexpected persistence failure).
 */
export async function createNotification(
  input: CreateNotificationInput,
  deps: Partial<NotificationDependencies> = {},
): Promise<AppNotification> {
  const { runTransaction } = {
    ...defaultNotificationDependencies(),
    ...deps,
  };

  assertValidCreateInput(input);

  return runTransaction(async (persistence) => {
    const recipient = await persistence.findRecipient(input.recipientId);
    if (!recipient) {
      throw new NotFoundError('Notification recipient not found', {
        field: 'recipientId',
        details: { recipientId: input.recipientId },
      });
    }

    const content = notificationContent(input.type);
    const title = input.title ?? content.title;
    const body = input.body ?? content.body;

    try {
      const record = await persistence.createNotification({
        userId: input.recipientId,
        type: input.type,
        title,
        body,
        rideId: input.rideId,
        requestId: input.requestId,
      });
      return toAppNotification(record);
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      const kind = persistence.classifyError(err);
      if (kind === 'foreign_key') {
        throw new NotFoundError('Notification recipient not found', {
          field: 'recipientId',
          details: { recipientId: input.recipientId },
        });
      }
      throw new InternalError('Failed to create notification', { cause: err });
    }
  });
}
