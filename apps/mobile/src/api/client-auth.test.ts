import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { MobileError } from './errors';
import {
  noAuthHeadersProvider,
  type AuthHeadersProvider,
} from '../auth/auth-headers';

const BASE_URL = 'https://api.example.com';

function stubFetch(impl: (url: string, init: RequestInit) => Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createApiClient with an authProvider (API credential propagation)', () => {
  it('attaches the auth provider headers to every request', async () => {
    stubFetch(async (_url, init) => {
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer token-123');
      return jsonResponse({ data: [] });
    });

    const authProvider: AuthHeadersProvider = {
      async getAuthHeaders() {
        return { Authorization: 'Bearer token-123' };
      },
    };
    const client = createApiClient({ baseUrl: BASE_URL, authProvider });
    await expect(client.request('/rides/discover')).resolves.toEqual([]);
  });

  it('attaches no auth headers when the provider resolves null (fail closed)', async () => {
    stubFetch(async (_url, init) => {
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
      return jsonResponse({ data: [] });
    });

    const client = createApiClient({
      baseUrl: BASE_URL,
      authProvider: noAuthHeadersProvider,
    });
    await expect(client.request('/rides')).resolves.toEqual([]);
  });

  it('lets auth-provided headers win over caller headers (identity is never caller-controlled)', async () => {
    stubFetch(async (_url, init) => {
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer real-token');
      return jsonResponse({ data: [] });
    });

    const authProvider: AuthHeadersProvider = {
      async getAuthHeaders() {
        return { Authorization: 'Bearer real-token' };
      },
    };
    const client = createApiClient({ baseUrl: BASE_URL, authProvider });
    await client.request('/rides', {
      headers: { Authorization: 'Bearer forged-token' },
    });
  });

  it('fails closed with a normalized MobileError and never sends the request when the provider throws', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const authProvider: AuthHeadersProvider = {
      async getAuthHeaders() {
        throw new Error('credential storage unavailable');
      },
    };
    const client = createApiClient({ baseUrl: BASE_URL, authProvider });
    const error = await client.request('/rides').catch((e) => e);

    expect(error).toBeInstanceOf(MobileError);
    expect((error as MobileError).kind).toBe('unknown');
    expect((error as MobileError).message).not.toContain(
      'credential storage unavailable',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
