import { NotificationType } from '@prisma/client';

export const SUPPORTED_NOTIFICATION_TYPES: readonly NotificationType[] = [
  NotificationType.RIDE_REQUESTED,
  NotificationType.REQUEST_ACCEPTED,
  NotificationType.REQUEST_REJECTED,
  NotificationType.REQUEST_CANCELLED,
  NotificationType.RIDE_CANCELLED,
  NotificationType.RIDE_EXPIRED,
  NotificationType.RIDE_CONFIRMED,
  NotificationType.CHAT_MESSAGE,
];

export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === 'string' &&
    (Object.values(NotificationType) as string[]).includes(value)
  );
}

export function isSupportedNotificationType(type: NotificationType): boolean {
  return SUPPORTED_NOTIFICATION_TYPES.includes(type);
}
