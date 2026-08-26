/**
 * Notification handlers (Phase 3.23).
 *
 * Handles foreground notification presentation, background delivery,
 * and notification tap responses. Persisted notification remains
 * authoritative — handlers only present/route.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type {
  ProcessedPushNotification,
  PushNotificationData,
} from './types.js';
import { navigateFromNotification } from './navigation.js';

/** Notification listener subscriptions for cleanup. */
let notificationListener: Notifications.Subscription | null = null;
let responseListener: Notifications.Subscription | null = null;

/** Sets up foreground notification handler. */
export function setupForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (_notification) => {
      // In foreground: show the notification but don't create duplicate records
      // The notification is already persisted on the backend
      return {
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      };
    },
  });
}

/** Subscribes to received notifications (foreground/background). */
export function subscribeToNotifications(
  onNotification: (notification: ProcessedPushNotification) => void,
): () => void {
  notificationListener = Notifications.addNotificationReceivedListener(
    (notification) => {
      const processed = processNotification(notification);
      onNotification(processed);
    },
  );

  return () => {
    notificationListener?.remove();
    notificationListener = null;
  };
}

/** Subscribes to notification tap responses. */
export function subscribeToNotificationResponses(
  onResponse: (notification: ProcessedPushNotification) => void,
): () => void {
  responseListener = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const processed = processNotification(response.notification);
      onResponse(processed);
    },
  );

  return () => {
    responseListener?.remove();
    responseListener = null;
  };
}

/** Processes a raw notification into a structured format. */
function processNotification(
  notification: Notifications.Notification,
): ProcessedPushNotification {
  const request = notification.request;
  const content = request.content;
  const data = (content.data ?? {}) as PushNotificationData;

  return {
    id: request.identifier,
    title: content.title ?? '',
    body: content.body ?? '',
    data,
    receivedAt: new Date(notification.date ?? Date.now()),
  };
}

/** Handles a notification tap by navigating to the appropriate screen. */
export async function handleNotificationTap(
  notification: ProcessedPushNotification,
): Promise<void> {
  await navigateFromNotification(notification.data);
}

/** Gets the last notification response (for cold start handling). */
export async function getLastNotificationResponse(): Promise<ProcessedPushNotification | null> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (response) {
      return processNotification(response.notification);
    }
    return null;
  } catch {
    return null;
  }
}

/** Cleans up all notification listeners. */
export function cleanupNotificationListeners(): void {
  notificationListener?.remove();
  notificationListener = null;
  responseListener?.remove();
  responseListener = null;
}

/** Schedules a local notification (for testing). */
export async function scheduleLocalNotification(
  title: string,
  body: string,
  data: PushNotificationData,
  seconds: number = 1,
): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      repeats: false,
    },
  });
}

/** Cancels all scheduled notifications. */
export async function cancelAllScheduledNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/** Sets the badge count (iOS). */
export async function setBadgeCount(count: number): Promise<void> {
  if (Platform.OS === 'ios') {
    await Notifications.setBadgeCountAsync(count);
  }
}
