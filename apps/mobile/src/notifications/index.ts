/**
 * Notifications module (Phase 3.23).
 *
 * Main entry point for the mobile notifications system. Coordinates:
 * - Permission management
 * - Token acquisition and registration
 * - Token lifecycle (registration, refresh, deactivation on logout)
 * - Foreground/background handling
 * - Notification tap routing
 *
 * Does NOT put implementation directly in App.tsx — use this module's
 * initialization functions.
 */
import { useEffect, useRef } from 'react';
import type {
  NotificationPermissionStatus,
  DevicePushTokenInfo,
} from './types.js';
import type { AppNavigation } from '../navigation/app-navigator.js';
import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
  shouldRequestPermission,
  configureAndroidChannel,
} from './permissions.js';
import {
  getExpoPushToken,
  registerDeviceToken,
  deactivateAllDeviceTokens,
} from './token.js';
import {
  setupForegroundHandler,
  subscribeToNotifications,
  subscribeToNotificationResponses,
  handleNotificationTap,
  getLastNotificationResponse,
  cleanupNotificationListeners,
  setBadgeCount,
} from './handlers.js';
import { setNotificationNavigationRef } from './navigation.js';
import { useAuth } from '../auth/auth-provider.js';
import type { ApiClient } from '../api/client.js';

/** Initialization state. */
let isInitialized = false;
let currentToken: DevicePushTokenInfo | null = null;
let apiClient: ApiClient | null = null;

/** Sets the API client for token operations. Call from AuthProvider or AppNavigator. */
export function setNotificationsApiClient(client: ApiClient): void {
  apiClient = client;
}

/** Initializes the notifications module. Call once on app startup. */
export async function initializeNotifications(
  navigationRef: React.RefObject<AppNavigation>,
): Promise<void> {
  if (isInitialized) return;

  // Set up navigation reference for tap routing
  setNotificationNavigationRef(navigationRef);

  // Configure Android notification channel
  await configureAndroidChannel();

  // Set up foreground handler
  setupForegroundHandler();

  // Subscribe to received notifications
  subscribeToNotifications((notification) => {
    console.log('Notification received:', notification);
    // Could update UI state here (e.g., unread badge)
  });

  // Subscribe to notification taps
  subscribeToNotificationResponses(async (notification) => {
    await handleNotificationTap(notification);
  });

  // Handle cold start from notification
  const lastResponse = await getLastNotificationResponse();
  if (lastResponse) {
    // Small delay to ensure navigation is ready
    setTimeout(() => handleNotificationTap(lastResponse), 100);
  }

  isInitialized = true;
}

/** Hook to set up auth listener for notifications. Use inside a component. */
export function useNotificationsAuth(): void {
  const { onStateChange } = useAuth();

  // Use a ref to track if we've already set up the listener
  const listenerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (listenerRef.current) {
      listenerRef.current();
    }

    listenerRef.current = onStateChange((status) => {
      if (status === 'authenticated') {
        registerCurrentDeviceToken();
      } else if (status === 'unauthenticated') {
        deactivateCurrentDeviceTokens();
      }
    });

    return () => {
      if (listenerRef.current) {
        listenerRef.current();
        listenerRef.current = null;
      }
    };
  }, [onStateChange]);
}

/** Registers the current device's push token with the backend. */
export async function registerCurrentDeviceToken(): Promise<boolean> {
  if (!apiClient) {
    console.error('API client not set for notifications');
    return false;
  }

  const permissionStatus = await getNotificationPermissionStatus();

  if (permissionStatus !== 'granted') {
    const shouldAsk = await shouldRequestPermission();
    if (shouldAsk) {
      const result = await requestNotificationPermission();
      if (result.status !== 'granted') {
        return false;
      }
    } else {
      return false;
    }
  }

  const tokenInfo = await getExpoPushToken();
  if (!tokenInfo) {
    return false;
  }

  const result = await registerDeviceToken(
    apiClient,
    tokenInfo.token,
    tokenInfo.platform,
  );
  if (result.success) {
    currentToken = tokenInfo;
    return true;
  }

  console.error('Failed to register device token:', result.error);
  return false;
}

/** Deactivates the current device's push tokens. */
export async function deactivateCurrentDeviceTokens(): Promise<void> {
  if (!apiClient) {
    console.error('API client not set for notifications');
    return;
  }

  await deactivateAllDeviceTokens(apiClient);
  currentToken = null;
}

/** Requests notification permission and registers token if granted. */
export async function requestPermissionAndRegister(): Promise<boolean> {
  const result = await requestNotificationPermission();
  if (result.status === 'granted') {
    return registerCurrentDeviceToken();
  }
  return false;
}

/** Gets the current permission status. */
export async function getCurrentPermissionStatus(): Promise<NotificationPermissionStatus> {
  return getNotificationPermissionStatus();
}

/** Checks if notifications are available and permission is granted. */
export async function areNotificationsEnabled(): Promise<boolean> {
  const status = await getNotificationPermissionStatus();
  return status === 'granted';
}

/** Gets the current device token info. */
export function getCurrentDeviceToken(): DevicePushTokenInfo | null {
  return currentToken;
}

/** Cleans up notification resources (for testing or logout). */
export function cleanupNotifications(): void {
  cleanupNotificationListeners();
  isInitialized = false;
  currentToken = null;
}

/** Sets the badge count (iOS only). */
export async function updateBadgeCount(count: number): Promise<void> {
  await setBadgeCount(count);
}
