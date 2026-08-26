/**
 * Centralized notification content (Phase 3.8).
 *
 * The single place that decides the human-readable `title` / `body` for a
 * notification type. Ride Engine operations never format their own
 * notification text — the event → notification mapping layer
 * (`notification-mapping.ts`) derives content through this module, so the
 * wording is consistent and easy to change in one place.
 *
 * Content is deliberately concise and UI-agnostic (no markup, no emoji, no
 * channel-specific formatting). This is not the OD-008 push provider — push
 * delivery stays OPEN.
 */
import { NotificationType } from '@prisma/client';
import { ValidationError } from '../../../lib/errors.js';

export interface NotificationContent {
  title: string;
  body: string;
}

/** Optional dynamic context used to personalize static content. */
export interface NotificationContentContext {
  /** The requester's display name (used by the RIDE_REQUESTED message). */
  requesterName?: string;
}

/**
 * Returns the canonical title/body for a supported notification type.
 *
 * Throws `ValidationError` for enum values that are not supported in this
 * phase (`notification-rules.ts`), so unsupported types can never reach
 * persistence with a fabricated message.
 */
export function notificationContent(
  type: NotificationType,
  context: NotificationContentContext = {},
): NotificationContent {
  switch (type) {
    case NotificationType.RIDE_REQUESTED:
      return {
        title: 'New ride request',
        body: context.requesterName
          ? `${context.requesterName} requested to join your ride`
          : 'A participant requested to join your ride',
      };
    case NotificationType.REQUEST_ACCEPTED:
      return {
        title: 'Ride request accepted',
        body: 'Your ride request was accepted',
      };
    case NotificationType.REQUEST_REJECTED:
      return {
        title: 'Ride request rejected',
        body: 'Your ride request was declined',
      };
    case NotificationType.REQUEST_CANCELLED:
      return {
        title: 'Ride request cancelled',
        body: 'A participant cancelled their ride request',
      };
    case NotificationType.RIDE_CANCELLED:
      return {
        title: 'Ride cancelled',
        body: 'A ride you joined was cancelled',
      };
    case NotificationType.RIDE_EXPIRED:
      return {
        title: 'Ride expired',
        body: 'A ride you joined has expired',
      };
    case NotificationType.RIDE_CONFIRMED:
      return {
        title: 'Ride confirmed',
        body: 'Your ride is confirmed',
      };
    default:
      throw new ValidationError('Unsupported notification type', {
        field: 'type',
        details: { type },
      });
  }
}
