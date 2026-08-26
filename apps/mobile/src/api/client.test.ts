import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_PATH } from '@ridepool/shared';
import { createApiClient } from './client';
import { MobileError } from './errors';

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

describe('createApiClient.request', () => {
  it('builds the correct URL under the versioned namespace and sends a GET', async () => {
    stubFetch(async (url, init) => {
      expect(url).toBe(`${BASE_URL}${API_BASE_PATH}/rides/discover`);
      expect(init.method).toBe('GET');
      return jsonResponse({ data: [] });
    });

    const client = createApiClient({ baseUrl: BASE_URL });
    await expect(client.request('/rides/discover')).resolves.toEqual([]);
  });

  it('unwraps the { data } success envelope into the typed result', async () => {
    stubFetch(async () => jsonResponse({ data: { id: 'r1', totalSeats: 3 } }));

    const client = createApiClient({ baseUrl: BASE_URL });
    const result = await client.request<{ id: string; totalSeats: number }>(
      '/rides',
    );
    expect(result).toEqual({ id: 'r1', totalSeats: 3 });
  });

  it('serializes the JSON body and honors method/headers', async () => {
    stubFetch(async (_url, init) => {
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({ totalSeats: 2 });
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Custom']).toBe('custom-value');
      return jsonResponse({ data: { id: 'r2' } });
    });

    const client = createApiClient({ baseUrl: BASE_URL });
    await client.request('/rides', {
      method: 'POST',
      body: { totalSeats: 2 },
      headers: { 'X-Custom': 'custom-value' },
    });
  });

  it('maps the shared error envelope to a normalized MobileError', async () => {
    stubFetch(async () =>
      jsonResponse(
        {
          error: {
            code: 'BUSINESS_RULE_VIOLATION',
            message: 'Ride cannot accept new requests in state CANCELLED',
            field: 'rideId',
            details: { status: 'CANCELLED' },
          },
        },
        422,
      ),
    );

    const client = createApiClient({ baseUrl: BASE_URL });
    const error = await client.request('/rides/r1/requests').catch((e) => e);

    expect(error).toBeInstanceOf(MobileError);
    const mobileError = error as MobileError;
    expect(mobileError.kind).toBe('business-rule');
    expect(mobileError.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(mobileError.statusCode).toBe(422);
    expect(mobileError.field).toBe('rideId');
    expect(mobileError.details).toEqual({ status: 'CANCELLED' });
    expect(mobileError.message).toBe(
      'Ride cannot accept new requests in state CANCELLED',
    );
  });

  it('maps validation and authentication codes to their kinds', async () => {
    const responses: Record<string, { body: unknown; status: number }> = {
      '/validation': {
        body: { error: { code: 'VALIDATION_ERROR', message: 'invalid' } },
        status: 400,
      },
      '/auth': {
        body: { error: { code: 'AUTHENTICATION_ERROR', message: 'denied' } },
        status: 401,
      },
    };
    stubFetch(async (url) => {
      const path = new URL(String(url)).pathname;
      const response = responses[path.slice(API_BASE_PATH.length)] ?? {
        body: { error: { code: 'INTERNAL_ERROR', message: 'nope' } },
        status: 500,
      };
      return jsonResponse(response.body, response.status);
    });

    const client = createApiClient({ baseUrl: BASE_URL });
    const validationError = await client.request('/validation').then(
      () => null,
      (e: unknown) => e as MobileError,
    );
    expect(validationError?.kind).toBe('validation');
    expect(validationError?.statusCode).toBe(400);

    const authError = await client.request('/auth').then(
      () => null,
      (e: unknown) => e as MobileError,
    );
    expect(authError?.kind).toBe('authentication');
    expect(authError?.statusCode).toBe(401);
  });

  it('classifies a transport failure as kind network without leaking the raw error', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });

    const client = createApiClient({ baseUrl: BASE_URL });
    const error = await client.request('/rides').catch((e) => e);

    expect(error).toBeInstanceOf(MobileError);
    expect((error as MobileError).kind).toBe('network');
    expect((error as MobileError).message).not.toContain('fetch failed');
  });

  it('classifies an aborted request as kind timeout', async () => {
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    const client = createApiClient({ baseUrl: BASE_URL, timeoutMs: 5 });
    const error = await client.request('/rides').catch((e) => e);

    expect(error).toBeInstanceOf(MobileError);
    expect((error as MobileError).kind).toBe('timeout');
  });

  it('resolves undefined for a 204 No Content response (e.g. DELETE)', async () => {
    stubFetch(async (_url, init) => {
      expect(init.method).toBe('DELETE');
      return new Response(null, { status: 204 });
    });

    const client = createApiClient({ baseUrl: BASE_URL });
    await expect(
      client.request('/blocks/user-2', { method: 'DELETE' }),
    ).resolves.toBeUndefined();
  });

  it('resolves undefined for an empty-body 2xx response', async () => {
    stubFetch(async () => new Response('', { status: 200 }));

    const client = createApiClient({ baseUrl: BASE_URL });
    await expect(client.request('/blocks/user-2')).resolves.toBeUndefined();
  });

  it('rejects a malformed success body (missing data envelope)', async () => {
    stubFetch(async () => jsonResponse({ unexpected: true }));

    const client = createApiClient({ baseUrl: BASE_URL });
    const error = await client.request('/rides').catch((e) => e);

    expect(error).toBeInstanceOf(MobileError);
    expect((error as MobileError).kind).toBe('unknown');
  });

  it('normalizes a non-JSON error body without leaking it', async () => {
    stubFetch(
      async () => new Response('Internal Server Error', { status: 500 }),
    );

    const client = createApiClient({ baseUrl: BASE_URL });
    const error = await client.request('/rides').catch((e) => e);

    expect(error).toBeInstanceOf(MobileError);
    expect((error as MobileError).kind).toBe('unknown');
    expect((error as MobileError).statusCode).toBe(500);
  });
});
