/**
 * Push notification dispatch service (Phase 3.23).
 *
 * Integrates push delivery into the existing notification creation flow.
 * Called after persisted notification + realtime notification are sent.
 * Best-effort: push failure NEVER rolls back the ride/request operation.
 */
import { NotificationType } from '@prisma/client';
import type { DevicePushTokenRow } from '../infrastructure/device-push-token.repository.js';
import type {
  PushNotificationProvider,
  SendPushNotificationInput,
  PushNotificationData,
} from '../infrastructure/push-provider.js';

/** Maps NotificationType to the data payload for push. */
function buildPushData(
  type: NotificationType,
  rideId: string | null,
  requestId: string | null,
): PushNotificationData {
  const data: PushNotificationData = { type };
  if (rideId) data.rideId = rideId;
  if (requestId) data.requestId = requestId;
  return data;
}

/**
 * Dispatches push notifications to all active devices for a list of recipients.
 * Called AFTER the notification is persisted and realtime event is published.
 * Best-effort: failures are logged but don't throw.
 */
export async function dispatchPushNotifications(
  provider: PushNotificationProvider,
  getActiveTokens: (userId: string) => Promise<DevicePushTokenRow[]>,
  deactivateToken: (token: string) => Promise<void>,
  notifications: Array<{
    recipientId: string;
    type: NotificationType;
    title: string;
    body: string;
    rideId: string | null;
    requestId: string | null;
  }>,
): Promise<void> {
  for (const notification of notifications) {
    const { recipientId, type, title, body, rideId, requestId } = notification;

    const tokens = await getActiveTokens(recipientId);
    if (tokens.length === 0) {
      continue;
    }

    const data = buildPushData(type, rideId, requestId);

    const sendPromises = tokens.map(async (deviceToken) => {
      const input: SendPushNotificationInput = {
        token: deviceToken.token,
        title,
        body,
        data,
      };

      const result = await provider.send(input);

      if (!result.success && result.failureKind === 'invalid-token') {
        await deactivateToken(deviceToken.token);
      }

      return result;
    });

    const results = await Promise.allSettled(sendPromises);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        console.error('Push notification send failed unexpectedly', {
          recipientId,
          token: tokens[i].token,
          error: result.reason,
        });
      }
    }
  }
}

/**
 * Convenience function that wires the push dispatch with real repository functions.
 * Used by the notification creation flow.
 */
export interface PushDispatchDependencies {
  provider: PushNotificationProvider;
  getActiveTokens: (userId: string) => Promise<DevicePushTokenRow[]>;
  deactivateToken: (token: string) => Promise<void>;
}

export async function dispatchPushWithDeps(
  deps: PushDispatchDependencies,
  notifications: Array<{
    recipientId: string;
    type: NotificationType;
    title: string;
    body: string;
    rideId: string | null;
    requestId: string | null;
  }>,
): Promise<void> {
  await dispatchPushNotifications(
    deps.provider,
    deps.getActiveTokens,
    deps.deactivateToken,
    notifications,
  );
}
