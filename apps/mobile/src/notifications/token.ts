/**
 * Push token management (Phase 3.23).
 *
 * Handles Expo push token acquisition, registration with backend, refresh,
 * and lifecycle. Uses the existing authenticated API client.
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { DevicePushTokenInfo, TokenRegistrationResult } from './types.js';
import type { ApiClient } from '../api/client.js';

/** Gets the Expo push token for this device. */
export async function getExpoPushToken(): Promise<DevicePushTokenInfo | null> {
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device');
    return null;
  }

  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    return {
      token: tokenData.data,
      platform: Platform.OS as 'android' | 'ios',
    };
  } catch (error) {
    console.error('Failed to get Expo push token:', error);
    return null;
  }
}

/** Registers the device token with the backend. */
export async function registerDeviceToken(
  api: ApiClient,
  token: string,
  platform: 'android' | 'ios',
): Promise<TokenRegistrationResult> {
  try {
    await api.request('/notifications/device-tokens', {
      method: 'POST',
      body: { token, platform },
    });

    return { success: true };
  } catch (error) {
    console.error('Failed to register device token:', error);
    return { success: false, error: 'Network error' };
  }
}

/** Deactivates the device token on the backend. */
export async function deactivateDeviceToken(
  api: ApiClient,
  token: string,
): Promise<void> {
  try {
    await api.request(
      `/notifications/device-tokens/${encodeURIComponent(token)}`,
      {
        method: 'DELETE',
      },
    );
  } catch (error) {
    console.error('Failed to deactivate device token:', error);
  }
}

/** Deactivates all device tokens for the current user. */
export async function deactivateAllDeviceTokens(api: ApiClient): Promise<void> {
  try {
    await api.request('/notifications/device-tokens', {
      method: 'DELETE',
    });
  } catch (error) {
    console.error('Failed to deactivate all device tokens:', error);
  }
}

/** Lists device tokens for the current user. */
export async function listDeviceTokens(
  api: ApiClient,
): Promise<DevicePushTokenInfo[]> {
  try {
    const response = await api.request<{
      data: Array<{ token: string; platform: string }>;
    }>('/notifications/device-tokens', { method: 'GET' });

    return response.data.map((t) => ({
      token: t.token,
      platform: t.platform as 'android' | 'ios',
    }));
  } catch (error) {
    console.error('Failed to list device tokens:', error);
    return [];
  }
}
