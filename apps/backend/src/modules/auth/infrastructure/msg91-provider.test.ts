/**
 * Unit tests for the MSG91 OTP provider (OD-005 — Phase 3.18).
 * No network: `fetchFn` is injected and pinned to the documented MSG91 API
 * contract (endpoint, query params, wire-format phone, success/error bodies).
 */
import { describe, expect, it } from 'vitest';
import { ExternalServiceError } from '../../../lib/errors.js';
import {
  createMsg91OtpProvider,
  MSG91_BASE_URL,
  MSG91_DEFAULT_SENDER_ID,
} from './msg91-provider.js';

const AUTH_KEY = 'test-auth-key';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function createFetchLog(): {
  calls: { url: string }[];
  fetcher: typeof fetch;
} {
  const calls: { url: string }[] = [];
  const fetcher = (async (input: unknown) => {
    const url = String(input);
    calls.push({ url });
    return jsonResponse({ type: 'success', message: 'sent' });
  }) as typeof fetch;
  return { calls, fetcher };
}

function urlParams(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('createMsg91OtpProvider — requestOtp', () => {
  it('calls /api/sendotp.php with the documented params and wire-format phone', async () => {
    const { calls, fetcher } = createFetchLog();
    const provider = createMsg91OtpProvider({
      authKey: AUTH_KEY,
      otpLength: 6,
      otpExpiryMinutes: 5,
      fetchFn: fetcher,
    });
    await provider.requestOtp('+919876543210');

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(`${MSG91_BASE_URL}/api/sendotp.php`);
    const params = url.searchParams;
    expect(params.get('authkey')).toBe(AUTH_KEY);
    expect(params.get('mobile')).toBe('919876543210'); // no leading +
    expect(params.get('sender')).toBe(MSG91_DEFAULT_SENDER_ID);
    expect(params.get('otp_expiry')).toBe('5');
    expect(params.get('otp_length')).toBe('6');
    expect(params.get('message')).toContain('##OTP##');
  });

  it('omits the sender override when the default is used', async () => {
    const { calls, fetcher } = createFetchLog();
    const provider = createMsg91OtpProvider({
      authKey: AUTH_KEY,
      senderId: 'MYCO',
      fetchFn: fetcher,
    });
    await provider.requestOtp('+919876543210');
    expect(urlParams(calls[0].url).get('sender')).toBe('MYCO');
  });

  it('fails closed when unconfigured (no auth key)', async () => {
    const provider = createMsg91OtpProvider({ authKey: null });
    await expect(provider.requestOtp('+919876543210')).rejects.toBeInstanceOf(
      ExternalServiceError,
    );
  });

  it('maps a provider error body to ExternalServiceError (message never propagated)', async () => {
    const fetcher = (async () =>
      jsonResponse({
        type: 'error',
        message: 'invalid authkey',
      })) as typeof fetch;
    const provider = createMsg91OtpProvider({
      authKey: AUTH_KEY,
      fetchFn: fetcher,
    });
    await expect(provider.requestOtp('+919876543210')).rejects.toBeInstanceOf(
      ExternalServiceError,
    );
  });

  it('maps a transport failure to ExternalServiceError', async () => {
    const fetcher = (async () => {
      throw new TypeError('network down');
    }) as typeof fetch;
    const provider = createMsg91OtpProvider({
      authKey: AUTH_KEY,
      fetchFn: fetcher,
    });
    await expect(provider.requestOtp('+919876543210')).rejects.toBeInstanceOf(
      ExternalServiceError,
    );
  });
});

describe('createMsg91OtpProvider — verifyOtp', () => {
  it('returns true on a success response', async () => {
    const fetcher = (async () =>
      jsonResponse({
        type: 'success',
        message: 'number_verified_successfully',
      })) as typeof fetch;
    const provider = createMsg91OtpProvider({
      authKey: AUTH_KEY,
      fetchFn: fetcher,
    });
    await expect(provider.verifyOtp('+919876543210', '123456')).resolves.toBe(
      true,
    );
  });

  it('returns false on a provider error response (wrong/expired code)', async () => {
    const fetcher = (async () =>
      jsonResponse({
        type: 'error',
        message: 'otp_not_matched',
      })) as typeof fetch;
    const provider = createMsg91OtpProvider({
      authKey: AUTH_KEY,
      fetchFn: fetcher,
    });
    await expect(provider.verifyOtp('+919876543210', '999999')).resolves.toBe(
      false,
    );
  });

  it('throws ExternalServiceError for an unparseable response', async () => {
    const fetcher = (async () =>
      ({
        text: async () => 'not json',
      }) as unknown as Response) as typeof fetch;
    const provider = createMsg91OtpProvider({
      authKey: AUTH_KEY,
      fetchFn: fetcher,
    });
    await expect(
      provider.verifyOtp('+919876543210', '123456'),
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });
});

describe('createMsg91OtpProvider — retryOtp', () => {
  it('calls /api/retryotp.php with retrytype=text and succeeds', async () => {
    const { calls, fetcher } = createFetchLog();
    const provider = createMsg91OtpProvider({
      authKey: AUTH_KEY,
      fetchFn: fetcher,
    });
    await provider.retryOtp('+919876543210');
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(
      `${MSG91_BASE_URL}/api/retryotp.php`,
    );
    expect(url.searchParams.get('retrytype')).toBe('text');
    expect(url.searchParams.get('mobile')).toBe('919876543210');
  });

  it('throws ExternalServiceError on a provider error body', async () => {
    const fetcher = (async () =>
      jsonResponse({ type: 'error', message: 'failed' })) as typeof fetch;
    const provider = createMsg91OtpProvider({
      authKey: AUTH_KEY,
      fetchFn: fetcher,
    });
    await expect(provider.retryOtp('+919876543210')).rejects.toBeInstanceOf(
      ExternalServiceError,
    );
  });
});
