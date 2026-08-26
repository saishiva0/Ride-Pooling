/**
 * Expo Push Notification Provider (Phase 3.23).
 *
 * Implements the provider-neutral PushNotificationProvider interface using
 * Expo's Push Service. All Expo-specific behavior is contained here.
 */
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import {
  PushNotificationProvider,
  SendPushNotificationInput,
  PushDispatchResult,
  PushFailureKind,
} from './push-provider.js';

/** Maps Expo ticket status to normalized failure kind. */
function mapExpoError(ticket: ExpoPushTicket): PushFailureKind {
  const details = (ticket as { details?: { error?: string } }).details;
  if (!details) return 'unknown';

  const error = details.error;
  if (!error) return 'unknown';

  switch (error) {
    case 'DeviceNotRegistered':
      return 'invalid-token';
    case 'MessageTooBig':
    case 'MessageRateExceeded':
      return 'rate-limited';
    case 'InvalidCredentials':
      return 'authentication-failure';
    case 'InvalidRequest':
      return 'malformed-request';
    default:
      return 'unknown';
  }
}

/** Creates the Expo push provider with the configured access token. */
export function createExpoPushProvider(
  accessToken?: string,
): PushNotificationProvider {
  const expo = new Expo({ accessToken });

  return {
    providerName: 'Expo',

    async send(input: SendPushNotificationInput): Promise<PushDispatchResult> {
      const { token, title, body, data } = input;

      if (!Expo.isExpoPushToken(token)) {
        return {
          pushId: `invalid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          success: false,
          failureKind: 'malformed-request',
          rawResponse: { reason: 'Token is not a valid Expo push token' },
        };
      }

      const message: ExpoPushMessage = {
        to: token,
        title,
        body,
        data: data as Record<string, unknown>,
        priority: 'high',
        sound: 'default',
        channelId: 'default',
      };

      try {
        const tickets = await expo.sendPushNotificationsAsync([message]);
        const ticket = tickets[0];

        if (ticket.status === 'ok') {
          return {
            pushId:
              (ticket as { id?: string }).id ??
              `expo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            success: true,
            rawResponse: ticket,
          };
        }

        return {
          pushId:
            (ticket as { id?: string }).id ??
            `expo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          success: false,
          failureKind: mapExpoError(ticket),
          rawResponse: ticket,
        };
      } catch (error) {
        const isNetworkError =
          error instanceof Error &&
          (error.message.includes('ECONNREFUSED') ||
            error.message.includes('ENOTFOUND') ||
            error.message.includes('timeout') ||
            error.message.includes('network'));

        return {
          pushId: `expo-error-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          success: false,
          failureKind: isNetworkError ? 'provider-unavailable' : 'unknown',
          rawResponse:
            error instanceof Error
              ? { message: error.message }
              : { error: String(error) },
        };
      }
    },
  };
}

/** Default provider instance (uses EXPO_ACCESS_TOKEN env var if set). */
export const defaultExpoPushProvider = createExpoPushProvider(
  process.env.EXPO_ACCESS_TOKEN,
);
