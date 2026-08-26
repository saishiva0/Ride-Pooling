import { NotificationType } from '@prisma/client';
import { ValidationError } from '../../../lib/errors.js';

export interface NotificationContent { title: string; body: string }
export interface NotificationContentContext { requesterName?: string; senderName?: string; }

export function notificationContent(type: NotificationType, context: NotificationContentContext = {}): NotificationContent {
  switch (type) {
    case NotificationType.RIDE_REQUESTED:
      return { title: 'New ride request', body: context.requesterName ? `${context.requesterName} requested to join your ride` : 'A participant requested to join your ride' };
    case NotificationType.REQUEST_ACCEPTED:
      return { title: 'Ride request accepted', body: 'Your ride request was accepted' };
    case NotificationType.REQUEST_REJECTED:
      return { title: 'Ride request rejected', body: 'Your ride request was declined' };
    case NotificationType.REQUEST_CANCELLED:
      return { title: 'Ride request cancelled', body: 'A participant cancelled their ride request' };
    case NotificationType.RIDE_CANCELLED:
      return { title: 'Ride cancelled', body: 'A ride you joined was cancelled' };
    case NotificationType.RIDE_EXPIRED:
      return { title: 'Ride expired', body: 'A ride you joined has expired' };
    case NotificationType.RIDE_CONFIRMED:
      return { title: 'Ride confirmed', body: 'Your ride is confirmed' };
    case NotificationType.CHAT_MESSAGE:
      return { title: context.senderName ? `${context.senderName} sent a message` : 'New chat message', body: 'You have a new message in your ride chat' };
    default:
      throw new ValidationError('Unsupported notification type', { field: 'type', details: { type } });
  }
}
