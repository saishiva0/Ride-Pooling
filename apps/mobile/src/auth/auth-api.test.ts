/**
 * Auth API surface tests (Phase 3.18 — OD-005 resolved).
 *
 * The auth API is a thin typed wrapper over the generic client: verify the
 * exact wire contract (path + method + body) with no business logic leaking in.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import { createAuthApi } from './auth-api';

function fakeClient() {
  const request = vi.fn();
  const client = { request } as unknown as ApiClient;
  return { client, request };
}

describe('createAuthApi (wire contract)', () => {
  it('requests an OTP via POST /auth/request-otp with the phone', async () => {
    const { client, request } = fakeClient();
    const api = createAuthApi(client);

    await api.requestOtp('+919876543210');

    expect(request).toHaveBeenCalledWith('/auth/request-otp', {
      method: 'POST',
      body: { phone: '+919876543210' },
    });
  });

  it('verifies an OTP via POST /auth/verify-otp with phone and otp', async () => {
    const { client, request } = fakeClient();
    const api = createAuthApi(client);

    await api.verifyOtp('+919876543210', '123456');

    expect(request).toHaveBeenCalledWith('/auth/verify-otp', {
      method: 'POST',
      body: { phone: '+919876543210', otp: '123456' },
    });
  });

  it('reads the session via GET /auth/me (rides the configured auth headers)', async () => {
    const { client, request } = fakeClient();
    const api = createAuthApi(client);

    await api.me();

    expect(request).toHaveBeenCalledWith('/auth/me');
  });

  it('logs out via POST /auth/logout', async () => {
    const { client, request } = fakeClient();
    const api = createAuthApi(client);

    await api.logout();

    expect(request).toHaveBeenCalledWith('/auth/logout', { method: 'POST' });
  });
});
