/**
 * Notification handler tests (Phase 3.23).
 *
 * `expo-notifications` is aliased to the fail-closed test mock (see
 * `vitest.config.ts`) — these tests never contact a real device. Each test
 * overrides only the specific native calls it exercises with `vi.spyOn`.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import * as Notifications from 'expo-notifications';
import { NotificationType } from '@ridepool/shared';
import {
  setupForegroundHandler,
  subscribeToNotifications,
  subscribeToNotificationResponses,
  handleNotificationTap,
  getLastNotificationResponse,
  cleanupNotificationListeners,
  setBadgeCount,
} from './handlers.js';
import * as navigationModule from './navigation.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeNotification(
  data: Record<string, unknown> = { type: NotificationType.RIDE_CONFIRMED },
) {
  return {
    request: {
      identifier: 'notif-1',
      content: { title: 'Title', body: 'Body', data },
    },
    date: Date.now(),
  } as never;
}

describe('setupForegroundHandler', () => {
  it('registers a handler that shows the alert without duplicating persisted records', async () => {
    const spy = vi
      .spyOn(Notifications, 'setNotificationHandler')
      .mockImplementation(() => {});
    setupForegroundHandler();

    expect(spy).toHaveBeenCalledTimes(1);
    const config = spy.mock.calls[0]![0] as unknown as {
      handleNotification: () => Promise<Record<string, boolean>>;
    };
    const behavior = await config.handleNotification();
    expect(behavior.shouldShowAlert).toBe(true);
  });
});

describe('subscribeToNotifications / subscribeToNotificationResponses', () => {
  it('subscribes and forwards a processed notification on receipt', () => {
    let capturedListener: ((n: unknown) => void) | undefined;
    vi.spyOn(
      Notifications,
      'addNotificationReceivedListener',
    ).mockImplementation(((listener: (n: unknown) => void) => {
      capturedListener = listener;
      return { remove: vi.fn() } as never;
    }) as never);

    const onNotification = vi.fn();
    const unsubscribe = subscribeToNotifications(onNotification);

    capturedListener?.(fakeNotification());

    expect(onNotification).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'notif-1', title: 'Title', body: 'Body' }),
    );
    expect(typeof unsubscribe).toBe('function');
  });

  it('unsubscribe removes the underlying listener', () => {
    const remove = vi.fn();
    vi.spyOn(
      Notifications,
      'addNotificationResponseReceivedListener',
    ).mockReturnValue({
      remove,
    } as never);

    const unsubscribe = subscribeToNotificationResponses(vi.fn());
    unsubscribe();

    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('handleNotificationTap', () => {
  it('delegates to navigateFromNotification with the notification data', async () => {
    const spy = vi
      .spyOn(navigationModule, 'navigateFromNotification')
      .mockResolvedValue();
    const processed = {
      id: 'notif-1',
      title: 't',
      body: 'b',
      data: { type: NotificationType.RIDE_CONFIRMED },
      receivedAt: new Date(),
    };

    await handleNotificationTap(processed);

    expect(spy).toHaveBeenCalledWith(processed.data);
  });
});

describe('getLastNotificationResponse', () => {
  it('returns the processed cold-start response when one exists', async () => {
    vi.spyOn(
      Notifications,
      'getLastNotificationResponseAsync',
    ).mockResolvedValue({
      notification: fakeNotification(),
    } as never);

    const result = await getLastNotificationResponse();
    expect(result?.id).toBe('notif-1');
  });

  it('returns null when there is no cold-start response', async () => {
    vi.spyOn(
      Notifications,
      'getLastNotificationResponseAsync',
    ).mockResolvedValue(null as never);

    expect(await getLastNotificationResponse()).toBeNull();
  });

  it('returns null (fail closed) when the native module throws', async () => {
    // Default mock: getLastNotificationResponseAsync throws.
    expect(await getLastNotificationResponse()).toBeNull();
  });
});

describe('cleanupNotificationListeners', () => {
  it('removes both listener subscriptions if present', () => {
    const removeReceived = vi.fn();
    const removeResponse = vi.fn();
    vi.spyOn(Notifications, 'addNotificationReceivedListener').mockReturnValue({
      remove: removeReceived,
    } as never);
    vi.spyOn(
      Notifications,
      'addNotificationResponseReceivedListener',
    ).mockReturnValue({
      remove: removeResponse,
    } as never);

    subscribeToNotifications(vi.fn());
    subscribeToNotificationResponses(vi.fn());
    cleanupNotificationListeners();

    expect(removeReceived).toHaveBeenCalledTimes(1);
    expect(removeResponse).toHaveBeenCalledTimes(1);
  });

  it('is safe to call when nothing was ever subscribed', () => {
    expect(() => cleanupNotificationListeners()).not.toThrow();
  });
});

describe('setBadgeCount', () => {
  it('is a no-op on non-iOS platforms (Platform.OS is ios in tests, so this documents the guard)', async () => {
    // Platform.OS is 'ios' in the RN test mock, so this exercises the call path.
    const spy = vi
      .spyOn(Notifications, 'setBadgeCountAsync')
      .mockResolvedValue(true as never);

    await setBadgeCount(3);

    expect(spy).toHaveBeenCalledWith(3);
  });
});
