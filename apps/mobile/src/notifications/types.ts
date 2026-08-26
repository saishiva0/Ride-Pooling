/**
 * Mobile notification types (Phase 3.23).
 *
 * Framework-free types for the notification domain. These mirror the backend
 * notification types and are used for navigation routing.
 */
import { NotificationType } from '@ridepool/shared';

/** Permission states for push notifications. */
export type NotificationPermissionStatus =
  'unknown' | 'requesting' | 'granted' | 'denied' | 'unavailable';

/** Device push token information. */
export interface DevicePushTokenInfo {
  token: string;
  platform: 'android' | 'ios';
}

/** Push notification data payload for navigation. */
export interface PushNotificationData {
  type: NotificationType;
  rideId?: string;
  requestId?: string;
  [key: string]: unknown;
}

/** Processed push notification for display/handling. */
export interface ProcessedPushNotification {
  id: string;
  title: string;
  body: string;
  data: PushNotificationData;
  receivedAt: Date;
}

/** Result of permission request. */
export interface PermissionRequestResult {
  status: NotificationPermissionStatus;
  canAskAgain: boolean;
}

/** Result of token registration with backend. */
export interface TokenRegistrationResult {
  success: boolean;
  error?: string;
}

/** Navigation target for notification taps. */
export interface NotificationNavigationTarget {
  route: string;
  params: Record<string, unknown>;
}
