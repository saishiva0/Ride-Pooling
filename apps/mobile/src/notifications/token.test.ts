/**
 * Push token management tests (Phase 3.23).
 *
 * `expo-notifications`/`expo-device`/`expo-constants` are aliased to
 * fail-closed test mocks (see `vitest.config.ts`); the backend is a fake
 * `ApiClient` — no network calls, no native modules.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import type { ApiClient } from '../api/client.js';
import {
  getExpoPushToken,
  registerDeviceToken,
  deactivateDeviceToken,
  deactivateAllDeviceTokens,
  listDeviceTokens,
} from './token.js';

function fakeClient() {
  const request = vi.fn();
  const client = { request } as unknown as ApiClient;
  return { client, request };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getExpoPushToken', () => {
  it('returns null without requesting a token when not a physical device', async () => {
    // Default mock: Device.isDevice is false.
    const spy = vi.spyOn(Notifications, 'getExpoPushTokenAsync');
    expect(await getExpoPushToken()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns the token and platform on a physical device', async () => {
    vi.spyOn(Device, 'isDevice', 'get').mockReturnValue(true);
    vi.spyOn(Notifications, 'getExpoPushTokenAsync').mockResolvedValue({
      data: 'ExponentPushToken[abc]',
    } as never);

    const result = await getExpoPushToken();
    expect(result?.token).toBe('ExponentPushToken[abc]');
  });

  it('returns null when the native call fails on a physical device', async () => {
    vi.spyOn(Device, 'isDevice', 'get').mockReturnValue(true);
    vi.spyOn(Notifications, 'getExpoPushTokenAsync').mockRejectedValue(
      new Error('no EAS project configured'),
    );

    expect(await getExpoPushToken()).toBeNull();
  });
});

describe('registerDeviceToken', () => {
  it('posts the token and platform to the backend', async () => {
    const { client, request } = fakeClient();
    request.mockResolvedValue({ data: {} });

    const result = await registerDeviceToken(client, 'token-1', 'android');

    expect(request).toHaveBeenCalledWith('/notifications/device-tokens', {
      method: 'POST',
      body: { token: 'token-1', platform: 'android' },
    });
    expect(result).toEqual({ success: true });
  });

  it('reports failure without throwing when the backend rejects', async () => {
    const { client, request } = fakeClient();
    request.mockRejectedValue(new Error('network down'));

    const result = await registerDeviceToken(client, 'token-1', 'android');

    expect(result.success).toBe(false);
  });
});

describe('deactivateDeviceToken / deactivateAllDeviceTokens', () => {
  it('deletes a single token by its URL-encoded value', async () => {
    const { client, request } = fakeClient();
    request.mockResolvedValue(undefined);

    await deactivateDeviceToken(client, 'token with spaces');

    expect(request).toHaveBeenCalledWith(
      '/notifications/device-tokens/token%20with%20spaces',
      { method: 'DELETE' },
    );
  });

  it('never throws when deactivation fails (logout must still succeed)', async () => {
    const { client, request } = fakeClient();
    request.mockRejectedValue(new Error('network down'));

    await expect(
      deactivateDeviceToken(client, 'token-1'),
    ).resolves.toBeUndefined();
  });

  it('deletes all tokens for the current user', async () => {
    const { client, request } = fakeClient();
    request.mockResolvedValue(undefined);

    await deactivateAllDeviceTokens(client);

    expect(request).toHaveBeenCalledWith('/notifications/device-tokens', {
      method: 'DELETE',
    });
  });

  it('never throws when deactivate-all fails', async () => {
    const { client, request } = fakeClient();
    request.mockRejectedValue(new Error('network down'));

    await expect(deactivateAllDeviceTokens(client)).resolves.toBeUndefined();
  });
});

describe('listDeviceTokens', () => {
  it('returns the backend-listed tokens', async () => {
    const { client, request } = fakeClient();
    request.mockResolvedValue({
      data: [{ token: 'a', platform: 'android' }],
    });

    const result = await listDeviceTokens(client);

    expect(result).toEqual([{ token: 'a', platform: 'android' }]);
  });

  it('returns an empty list rather than throwing on failure', async () => {
    const { client, request } = fakeClient();
    request.mockRejectedValue(new Error('network down'));

    expect(await listDeviceTokens(client)).toEqual([]);
  });
});
