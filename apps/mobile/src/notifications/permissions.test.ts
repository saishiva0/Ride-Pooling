/**
 * Notification permission tests (Phase 3.23).
 *
 * `expo-notifications` is aliased to the fail-closed test mock (see
 * `vitest.config.ts`) — these tests never contact a real device or the
 * Expo servers. Each test overrides only the specific native calls it
 * exercises with `vi.spyOn`.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import * as Notifications from 'expo-notifications';
import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
  shouldRequestPermission,
  configureAndroidChannel,
} from './permissions.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getNotificationPermissionStatus', () => {
  it.each([
    ['granted', 'granted'],
    ['denied', 'denied'],
    ['undetermined', 'unknown'],
  ] as const)('maps native status %s to %s', async (native, expected) => {
    vi.spyOn(Notifications, 'getPermissionsAsync').mockResolvedValue({
      status: native,
    } as never);

    expect(await getNotificationPermissionStatus()).toBe(expected);
  });

  it('is unavailable (fail closed) when the native module throws', async () => {
    // Default mock: getPermissionsAsync throws.
    expect(await getNotificationPermissionStatus()).toBe('unavailable');
  });
});

describe('requestNotificationPermission', () => {
  it('returns granted with canAskAgain when the user grants', async () => {
    vi.spyOn(Notifications, 'requestPermissionsAsync').mockResolvedValue({
      status: 'granted',
      canAskAgain: true,
    } as never);

    const result = await requestNotificationPermission();
    expect(result).toEqual({ status: 'granted', canAskAgain: true });
  });

  it('returns denied with canAskAgain: false after permanent denial', async () => {
    vi.spyOn(Notifications, 'requestPermissionsAsync').mockResolvedValue({
      status: 'denied',
      canAskAgain: false,
    } as never);

    const result = await requestNotificationPermission();
    expect(result).toEqual({ status: 'denied', canAskAgain: false });
  });

  it('is unavailable (fail closed) when the native module throws', async () => {
    const result = await requestNotificationPermission();
    expect(result).toEqual({ status: 'unavailable', canAskAgain: false });
  });
});

describe('shouldRequestPermission', () => {
  it('is true only when the status is unknown (undetermined)', async () => {
    vi.spyOn(Notifications, 'getPermissionsAsync').mockResolvedValue({
      status: 'undetermined',
    } as never);

    expect(await shouldRequestPermission()).toBe(true);
  });

  it.each(['granted', 'denied'] as const)(
    'is false when the status is already %s (never re-prompts)',
    async (status) => {
      vi.spyOn(Notifications, 'getPermissionsAsync').mockResolvedValue({
        status,
      } as never);

      expect(await shouldRequestPermission()).toBe(false);
    },
  );

  it('is false when the module is unavailable', async () => {
    expect(await shouldRequestPermission()).toBe(false);
  });
});

describe('configureAndroidChannel', () => {
  it('is a no-op on non-Android platforms (Platform.OS is ios in tests)', async () => {
    const spy = vi.spyOn(Notifications, 'setNotificationChannelAsync');
    await expect(configureAndroidChannel()).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
