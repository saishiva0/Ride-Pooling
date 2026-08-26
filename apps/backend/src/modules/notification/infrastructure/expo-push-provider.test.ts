/**
 * Unit tests for the Expo push provider (Phase 3.23).
 *
 * Mocks `expo-server-sdk` entirely — these tests never contact Expo's
 * servers. Covers: malformed-token short circuit, every PushFailureKind
 * mapping from an Expo ticket, and network-style errors mapping to
 * provider-unavailable.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createExpoPushProvider } from './expo-push-provider.js';

const sendPushNotificationsAsync = vi.fn();
const isExpoPushToken = vi.fn();

vi.mock('expo-server-sdk', () => ({
  Expo: class {
    static isExpoPushToken(token: string) {
      return isExpoPushToken(token);
    }
    sendPushNotificationsAsync(...args: unknown[]) {
      return sendPushNotificationsAsync(...args);
    }
  },
}));

const baseInput = {
  token: 'ExponentPushToken[abc]',
  title: 'Ride confirmed',
  body: 'Your ride is confirmed',
  data: { type: 'RIDE_CONFIRMED' as const },
};

describe('createExpoPushProvider', () => {
  beforeEach(() => {
    sendPushNotificationsAsync.mockReset();
    isExpoPushToken.mockReset();
    isExpoPushToken.mockReturnValue(true);
  });

  it('short-circuits with malformed-request when the token is not a valid Expo push token', async () => {
    isExpoPushToken.mockReturnValue(false);
    const provider = createExpoPushProvider();

    const result = await provider.send(baseInput);

    expect(result.success).toBe(false);
    expect(result.failureKind).toBe('malformed-request');
    expect(sendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it('reports success when the ticket status is ok', async () => {
    sendPushNotificationsAsync.mockResolvedValue([
      { status: 'ok', id: 'ticket_1' },
    ]);
    const provider = createExpoPushProvider();

    const result = await provider.send(baseInput);

    expect(result.success).toBe(true);
    expect(result.pushId).toBe('ticket_1');
  });

  it.each([
    ['DeviceNotRegistered', 'invalid-token'],
    ['MessageTooBig', 'rate-limited'],
    ['MessageRateExceeded', 'rate-limited'],
    ['InvalidCredentials', 'authentication-failure'],
    ['InvalidRequest', 'malformed-request'],
    ['SomethingElse', 'unknown'],
  ] as const)(
    'maps Expo ticket error %s to failureKind %s',
    async (expoError, expected) => {
      sendPushNotificationsAsync.mockResolvedValue([
        { status: 'error', details: { error: expoError } },
      ]);
      const provider = createExpoPushProvider();

      const result = await provider.send(baseInput);

      expect(result.success).toBe(false);
      expect(result.failureKind).toBe(expected);
    },
  );

  it('maps a ticket error with no details to unknown', async () => {
    sendPushNotificationsAsync.mockResolvedValue([{ status: 'error' }]);
    const provider = createExpoPushProvider();

    const result = await provider.send(baseInput);

    expect(result.failureKind).toBe('unknown');
  });

  it.each(['ECONNREFUSED', 'ENOTFOUND', 'request timeout', 'network error'])(
    'maps a thrown error containing "%s" to provider-unavailable',
    async (message) => {
      sendPushNotificationsAsync.mockRejectedValue(new Error(message));
      const provider = createExpoPushProvider();

      const result = await provider.send(baseInput);

      expect(result.success).toBe(false);
      expect(result.failureKind).toBe('provider-unavailable');
    },
  );

  it('maps an unrecognized thrown error to unknown', async () => {
    sendPushNotificationsAsync.mockRejectedValue(new Error('something odd'));
    const provider = createExpoPushProvider();

    const result = await provider.send(baseInput);

    expect(result.success).toBe(false);
    expect(result.failureKind).toBe('unknown');
  });

  it('never throws — send() always resolves', async () => {
    sendPushNotificationsAsync.mockRejectedValue(new Error('boom'));
    const provider = createExpoPushProvider();

    await expect(provider.send(baseInput)).resolves.toBeDefined();
  });
});
