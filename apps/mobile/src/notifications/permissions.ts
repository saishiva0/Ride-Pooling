/**
 * Notification permissions (Phase 3.23).
 *
 * Manages permission states and requests. Does NOT request permission on every
 * launch. Does NOT repeatedly prompt after permanent denial. App remains fully
 * usable when notifications are unavailable.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type {
  NotificationPermissionStatus,
  PermissionRequestResult,
} from './types.js';

/** Checks the current notification permission status. */
export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  try {
    const { status } = await Notifications.getPermissionsAsync();

    switch (status) {
      case 'granted':
        return 'granted';
      case 'denied':
        return 'denied';
      case 'undetermined':
        return 'unknown';
      default:
        return 'unavailable';
    }
  } catch {
    return 'unavailable';
  }
}

/** Requests notification permission from the user. */
export async function requestNotificationPermission(): Promise<PermissionRequestResult> {
  try {
    const { status, canAskAgain } =
      await Notifications.requestPermissionsAsync();

    let newStatus: NotificationPermissionStatus;
    switch (status) {
      case 'granted':
        newStatus = 'granted';
        break;
      case 'denied':
        newStatus = 'denied';
        break;
      case 'undetermined':
        newStatus = 'unknown';
        break;
      default:
        newStatus = 'unavailable';
    }

    return { status: newStatus, canAskAgain: canAskAgain ?? false };
  } catch {
    return { status: 'unavailable', canAskAgain: false };
  }
}

/** Checks if we should ask for permission (not denied permanently). */
export async function shouldRequestPermission(): Promise<boolean> {
  const status = await getNotificationPermissionStatus();
  return status === 'unknown';
}

/** Gets the appropriate notification channel configuration for Android. */
export async function configureAndroidChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF6B35',
      sound: 'default',
      enableVibrate: true,
      enableLights: true,
    });
  }
}

/** Sets the notification handler for foreground presentation. */
export function setNotificationHandler(
  handler: Notifications.NotificationHandler | null,
): void {
  Notifications.setNotificationHandler(handler);
}
