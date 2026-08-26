/**
 * Push notification provider abstraction (Phase 3.23).
 *
 * Provider-neutral interface for sending push notifications. The abstraction
 * normalizes provider-specific errors into a unified result type so the
 * notification domain never depends on Expo/FCM/APNs specifics.
 */
import { NotificationType } from '@prisma/client';

/** Normalized push dispatch result. */
export interface PushDispatchResult {
  /** Unique identifier for the push attempt (provider-specific or generated). */
  pushId: string;
  /** Whether the push was accepted by the provider for delivery. */
  success: boolean;
  /** Normalized failure kind when success is false. */
  failureKind?: PushFailureKind;
  /** Provider-specific raw response for diagnostics (never exposed to clients). */
  rawResponse?: unknown;
}

/** Normalized push failure categories. */
export type PushFailureKind =
  | 'invalid-token'
  | 'provider-unavailable'
  | 'rate-limited'
  | 'malformed-request'
  | 'authentication-failure'
  | 'unknown';

/** Data payload for push notifications — supports typed mobile navigation. */
export interface PushNotificationData {
  /** The notification type for routing. */
  type: NotificationType;
  /** The ride ID for navigation context. */
  rideId?: string;
  /** The request ID for navigation context. */
  requestId?: string;
  /** Additional custom data. */
  [key: string]: unknown;
}

/** Input for sending a push notification. */
export interface SendPushNotificationInput {
  /** The Expo push token (or provider-specific token). */
  token: string;
  /** Notification title. */
  title: string;
  /** Notification body. */
  body: string;
  /** Data payload for navigation. */
  data: PushNotificationData;
}

/** Provider interface — implemented by Expo, FCM, APNs, etc. */
export interface PushNotificationProvider {
  /** Send a push notification to a single device token. */
  send(input: SendPushNotificationInput): Promise<PushDispatchResult>;
  /** Provider name for logging/diagnostics. */
  readonly providerName: string;
}
