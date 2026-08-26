/**
 * Push notification publisher registry (Phase 3.23).
 *
 * Follows the same pattern as EventPublisher (Phase 3.11): the application
 * layer depends on an abstraction, the infrastructure provides the concrete
 * implementation, and a registry allows the server to activate the real
 * provider without coupling application code to Expo/FCM/APNs.
 */
import type { NotificationDraft } from '../../notification/application/notification-mapping.js';
import {
  dispatchPushNotifications,
  type PushDispatchDependencies,
} from '../../notification/application/push-dispatch.js';

/** Framework-independent push dispatch capability. */
export interface PushNotificationDispatcher {
  dispatch(notifications: ReadonlyArray<NotificationDraft>): Promise<void>;
}

/** Default: dispatches nothing. Safe until the server activates the real dispatcher. */
export const noopPushDispatcher: PushNotificationDispatcher = {
  dispatch: async () => {},
};

let activePushDispatcher: PushNotificationDispatcher = noopPushDispatcher;

/** Activates the real push dispatcher (called by the server on init). */
export function setPushNotificationDispatcher(
  dispatcher: PushNotificationDispatcher,
): void {
  activePushDispatcher = dispatcher;
}

/** Restores the no-op dispatcher (test teardown). */
export function resetPushNotificationDispatcher(): void {
  activePushDispatcher = noopPushDispatcher;
}

/** Returns the currently active dispatcher (defaults to no-op). */
export function getPushNotificationDispatcher(): PushNotificationDispatcher {
  return activePushDispatcher;
}

/**
 * Creates a push dispatcher wired with the real provider and repository.
 * Called by the server during startup when push is enabled.
 */
export function createPushNotificationDispatcher(
  deps: PushDispatchDependencies,
): PushNotificationDispatcher {
  return {
    dispatch: (notifications) =>
      dispatchPushNotifications(
        deps.provider,
        deps.getActiveTokens,
        deps.deactivateToken,
        notifications.map((n) => ({
          recipientId: n.recipientId,
          type: n.type,
          title: n.title,
          body: n.body,
          rideId: n.rideId,
          requestId: n.requestId ?? null,
        })),
      ),
  };
}
