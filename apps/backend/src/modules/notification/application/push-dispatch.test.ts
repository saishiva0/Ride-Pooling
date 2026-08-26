/**
 * Unit tests for push dispatch (Phase 3.23).
 *
 * Uses hand-rolled fakes for the provider and repository ports — no network
 * calls, no database. Covers: successful send, invalid-token deactivation,
 * non-invalid-token failures leaving the token active, multi-device partial
 * failure, and the zero-active-tokens no-op path.
 */
import { describe, expect, it, vi } from 'vitest';
import { NotificationType } from '@prisma/client';
import { dispatchPushNotifications } from './push-dispatch.js';
import type { DevicePushTokenRow } from '../infrastructure/device-push-token.repository.js';
import type {
  PushDispatchResult,
  PushNotificationProvider,
  SendPushNotificationInput,
} from '../infrastructure/push-provider.js';

function makeToken(
  overrides: Partial<DevicePushTokenRow> = {},
): DevicePushTokenRow {
  return {
    id: `token_${Math.random().toString(36).slice(2)}`,
    userId: 'user_1',
    token: `ExponentPushToken[${Math.random().toString(36).slice(2)}]`,
    platform: 'android',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSeenAt: new Date(),
    ...overrides,
  };
}

function makeNotification(
  overrides: Partial<{
    recipientId: string;
    type: NotificationType;
    title: string;
    body: string;
    rideId: string | null;
    requestId: string | null;
  }> = {},
) {
  return {
    recipientId: 'user_1',
    type: NotificationType.RIDE_CONFIRMED,
    title: 'title',
    body: 'body',
    rideId: 'ride_1',
    requestId: null,
    ...overrides,
  };
}

function fakeProvider(
  send: (input: SendPushNotificationInput) => Promise<PushDispatchResult>,
): PushNotificationProvider {
  return { providerName: 'fake', send };
}

describe('dispatchPushNotifications', () => {
  it('does nothing when the recipient has no active tokens', async () => {
    const send = vi.fn();
    const deactivateToken = vi.fn();

    await dispatchPushNotifications(
      fakeProvider(send),
      async () => [],
      deactivateToken,
      [makeNotification()],
    );

    expect(send).not.toHaveBeenCalled();
    expect(deactivateToken).not.toHaveBeenCalled();
  });

  it('sends to every active token for the recipient and passes the notification data', async () => {
    const token = makeToken();
    const send = vi.fn(
      async (
        _input: SendPushNotificationInput,
      ): Promise<PushDispatchResult> => ({
        pushId: 'push_1',
        success: true,
      }),
    );
    const deactivateToken = vi.fn();

    await dispatchPushNotifications(
      fakeProvider(send),
      async () => [token],
      deactivateToken,
      [makeNotification({ rideId: 'ride_1', requestId: 'req_1' })],
    );

    expect(send).toHaveBeenCalledTimes(1);
    const input = send.mock.calls[0]![0];
    expect(input.token).toBe(token.token);
    expect(input.data).toEqual({
      type: NotificationType.RIDE_CONFIRMED,
      rideId: 'ride_1',
      requestId: 'req_1',
    });
    expect(deactivateToken).not.toHaveBeenCalled();
  });

  it('deactivates the token when the provider reports invalid-token', async () => {
    const token = makeToken();
    const send = vi.fn(async (): Promise<PushDispatchResult> => ({
      pushId: 'push_1',
      success: false,
      failureKind: 'invalid-token',
    }));
    const deactivateToken = vi.fn();

    await dispatchPushNotifications(
      fakeProvider(send),
      async () => [token],
      deactivateToken,
      [makeNotification()],
    );

    expect(deactivateToken).toHaveBeenCalledWith(token.token);
  });

  it.each([
    'provider-unavailable',
    'rate-limited',
    'malformed-request',
    'unknown',
  ] as const)(
    'does NOT deactivate the token on a %s failure',
    async (failureKind) => {
      const token = makeToken();
      const send = vi.fn(async (): Promise<PushDispatchResult> => ({
        pushId: 'push_1',
        success: false,
        failureKind,
      }));
      const deactivateToken = vi.fn();

      await dispatchPushNotifications(
        fakeProvider(send),
        async () => [token],
        deactivateToken,
        [makeNotification()],
      );

      expect(deactivateToken).not.toHaveBeenCalled();
    },
  );

  it('continues sending to remaining devices when one device fails', async () => {
    const good = makeToken({ token: 'good-token' });
    const bad = makeToken({ token: 'bad-token' });
    const deactivateToken = vi.fn();

    const send = vi.fn(
      async (input: SendPushNotificationInput): Promise<PushDispatchResult> => {
        if (input.token === 'bad-token') {
          return {
            pushId: 'push_bad',
            success: false,
            failureKind: 'invalid-token',
          };
        }
        return { pushId: 'push_good', success: true };
      },
    );

    await dispatchPushNotifications(
      fakeProvider(send),
      async () => [good, bad],
      deactivateToken,
      [makeNotification()],
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(deactivateToken).toHaveBeenCalledTimes(1);
    expect(deactivateToken).toHaveBeenCalledWith('bad-token');
  });

  it('never throws when the provider rejects unexpectedly', async () => {
    const token = makeToken();
    const send = vi.fn(async () => {
      throw new Error('network exploded');
    });
    const deactivateToken = vi.fn();

    await expect(
      dispatchPushNotifications(
        fakeProvider(send),
        async () => [token],
        deactivateToken,
        [makeNotification()],
      ),
    ).resolves.toBeUndefined();

    expect(deactivateToken).not.toHaveBeenCalled();
  });

  it('dispatches independently per recipient across multiple notifications', async () => {
    const tokenA = makeToken({ userId: 'user_a', token: 'token-a' });
    const tokenB = makeToken({ userId: 'user_b', token: 'token-b' });
    const tokensByUser: Record<string, DevicePushTokenRow[]> = {
      user_a: [tokenA],
      user_b: [tokenB],
    };
    const send = vi.fn(
      async (
        _input: SendPushNotificationInput,
      ): Promise<PushDispatchResult> => ({
        pushId: 'push_1',
        success: true,
      }),
    );

    await dispatchPushNotifications(
      fakeProvider(send),
      async (userId) => tokensByUser[userId] ?? [],
      vi.fn(),
      [
        makeNotification({ recipientId: 'user_a' }),
        makeNotification({ recipientId: 'user_b' }),
      ],
    );

    expect(send).toHaveBeenCalledTimes(2);
    const sentTokens = send.mock.calls.map((call) => call[0]!.token);
    expect(sentTokens).toEqual(['token-a', 'token-b']);
  });
});
