/**
 * Notifications module orchestrator tests (Phase 3.23).
 *
 * `expo-notifications`/`expo-device`/`expo-constants` are aliased to
 * fail-closed test mocks (see `vitest.config.ts`). `apiClient`/`currentToken`
 * are module-level singleton state (matching the real app, which has exactly
 * one notifications module instance) — the "no API client configured" cases
 * run first, before any other test calls `setNotificationsApiClient`.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { act } from 'react-test-renderer';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import type { ApiClient } from '../api/client.js';
import { renderAndSettle, flushAsync } from '../../tests/render.js';

const { onStateChange } = vi.hoisted(() => ({
  onStateChange: vi.fn<(cb: (status: string) => void) => () => void>(),
}));
vi.mock('../auth/auth-provider.js', () => ({
  useAuth: () => ({ onStateChange }),
}));

import {
  setNotificationsApiClient,
  registerCurrentDeviceToken,
  deactivateCurrentDeviceTokens,
  requestPermissionAndRegister,
  getCurrentPermissionStatus,
  areNotificationsEnabled,
  getCurrentDeviceToken,
  cleanupNotifications,
  updateBadgeCount,
  useNotificationsAuth,
} from './index.js';

function fakeClient() {
  const request = vi.fn().mockResolvedValue({ data: {} });
  const client = { request } as unknown as ApiClient;
  return { client, request };
}

function grantedDevice(token = 'ExponentPushToken[abc]') {
  vi.spyOn(Device, 'isDevice', 'get').mockReturnValue(true);
  vi.spyOn(Notifications, 'getPermissionsAsync').mockResolvedValue({
    status: 'granted',
  } as never);
  vi.spyOn(Notifications, 'getExpoPushTokenAsync').mockResolvedValue({
    data: token,
  } as never);
}

afterEach(() => {
  cleanupNotifications();
  vi.restoreAllMocks();
});

describe('without a configured API client', () => {
  it('registerCurrentDeviceToken fails closed (false, no crash)', async () => {
    expect(await registerCurrentDeviceToken()).toBe(false);
  });

  it('deactivateCurrentDeviceTokens resolves without throwing', async () => {
    await expect(deactivateCurrentDeviceTokens()).resolves.toBeUndefined();
  });
});

describe('registerCurrentDeviceToken', () => {
  it('returns false when permission is denied and re-prompting is not allowed', async () => {
    setNotificationsApiClient(fakeClient().client);
    vi.spyOn(Notifications, 'getPermissionsAsync').mockResolvedValue({
      status: 'denied',
    } as never);

    expect(await registerCurrentDeviceToken()).toBe(false);
  });

  it('acquires a token and registers it when permission is already granted', async () => {
    const { client, request } = fakeClient();
    setNotificationsApiClient(client);
    grantedDevice('ExponentPushToken[granted]');

    const result = await registerCurrentDeviceToken();

    expect(result).toBe(true);
    expect(request).toHaveBeenCalledWith('/notifications/device-tokens', {
      method: 'POST',
      body: { token: 'ExponentPushToken[granted]', platform: 'ios' },
    });
    expect(getCurrentDeviceToken()?.token).toBe('ExponentPushToken[granted]');
  });

  it('returns false when the backend registration call fails', async () => {
    const { client, request } = fakeClient();
    request.mockRejectedValue(new Error('network down'));
    setNotificationsApiClient(client);
    grantedDevice();

    expect(await registerCurrentDeviceToken()).toBe(false);
  });

  it('returns false without registering when no token can be acquired (not a device)', async () => {
    const { client, request } = fakeClient();
    setNotificationsApiClient(client);
    vi.spyOn(Notifications, 'getPermissionsAsync').mockResolvedValue({
      status: 'granted',
    } as never);
    // Device.isDevice stays false (default fail-closed mock).

    expect(await registerCurrentDeviceToken()).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('deactivateCurrentDeviceTokens', () => {
  it('deactivates all tokens on the backend and clears the current token', async () => {
    const { client, request } = fakeClient();
    setNotificationsApiClient(client);
    grantedDevice();
    await registerCurrentDeviceToken();

    await deactivateCurrentDeviceTokens();

    expect(request).toHaveBeenCalledWith('/notifications/device-tokens', {
      method: 'DELETE',
    });
    expect(getCurrentDeviceToken()).toBeNull();
  });

  it('logout still succeeds even when the backend call fails', async () => {
    const { client, request } = fakeClient();
    request.mockRejectedValue(new Error('network down'));
    setNotificationsApiClient(client);

    await expect(deactivateCurrentDeviceTokens()).resolves.toBeUndefined();
  });
});

describe('requestPermissionAndRegister / status helpers', () => {
  it('registers only after the user grants permission', async () => {
    const { client, request } = fakeClient();
    setNotificationsApiClient(client);
    vi.spyOn(Device, 'isDevice', 'get').mockReturnValue(true);
    vi.spyOn(Notifications, 'requestPermissionsAsync').mockResolvedValue({
      status: 'granted',
      canAskAgain: true,
    } as never);
    vi.spyOn(Notifications, 'getPermissionsAsync').mockResolvedValue({
      status: 'granted',
    } as never);
    vi.spyOn(Notifications, 'getExpoPushTokenAsync').mockResolvedValue({
      data: 'ExponentPushToken[req]',
    } as never);

    expect(await requestPermissionAndRegister()).toBe(true);
    expect(request).toHaveBeenCalled();
  });

  it('does not register when the user denies permission', async () => {
    const { client, request } = fakeClient();
    setNotificationsApiClient(client);
    vi.spyOn(Notifications, 'requestPermissionsAsync').mockResolvedValue({
      status: 'denied',
      canAskAgain: false,
    } as never);

    expect(await requestPermissionAndRegister()).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('getCurrentPermissionStatus reflects the native status', async () => {
    vi.spyOn(Notifications, 'getPermissionsAsync').mockResolvedValue({
      status: 'granted',
    } as never);
    expect(await getCurrentPermissionStatus()).toBe('granted');
  });

  it('areNotificationsEnabled is true only when granted', async () => {
    vi.spyOn(Notifications, 'getPermissionsAsync').mockResolvedValue({
      status: 'granted',
    } as never);
    expect(await areNotificationsEnabled()).toBe(true);
  });
});

describe('updateBadgeCount', () => {
  it('forwards to the native badge API', async () => {
    const spy = vi
      .spyOn(Notifications, 'setBadgeCountAsync')
      .mockResolvedValue(true as never);

    await updateBadgeCount(5);

    expect(spy).toHaveBeenCalledWith(5);
  });
});

describe('useNotificationsAuth wiring', () => {
  function Probe() {
    useNotificationsAuth();
    return null;
  }

  it('registers a device token when auth becomes authenticated', async () => {
    const { client, request } = fakeClient();
    setNotificationsApiClient(client);
    grantedDevice('ExponentPushToken[hook]');
    let statusCallback: ((status: string) => void) | undefined;
    onStateChange.mockImplementation((cb) => {
      statusCallback = cb;
      return vi.fn();
    });

    await renderAndSettle(createElement(Probe));
    statusCallback?.('authenticated');
    await flushAsync();

    expect(request).toHaveBeenCalledWith('/notifications/device-tokens', {
      method: 'POST',
      body: { token: 'ExponentPushToken[hook]', platform: 'ios' },
    });
  });

  it('deactivates device tokens when auth becomes unauthenticated', async () => {
    const { client, request } = fakeClient();
    setNotificationsApiClient(client);
    let statusCallback: ((status: string) => void) | undefined;
    onStateChange.mockImplementation((cb) => {
      statusCallback = cb;
      return vi.fn();
    });

    await renderAndSettle(createElement(Probe));
    statusCallback?.('unauthenticated');
    await flushAsync();

    expect(request).toHaveBeenCalledWith('/notifications/device-tokens', {
      method: 'DELETE',
    });
  });

  it('unsubscribes the previous listener on unmount', async () => {
    const unsubscribe = vi.fn();
    onStateChange.mockReturnValue(unsubscribe);

    const root = await renderAndSettle(createElement(Probe));
    await act(async () => {
      root.unmount();
    });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
