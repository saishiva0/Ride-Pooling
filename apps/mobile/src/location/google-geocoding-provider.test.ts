/**
 * Google Geocoding provider tests (Phase 3.20). Deterministic: `fetch` is
 * injected, so no network is ever used. Pins request URL construction and the
 * status → `MobileError` normalization.
 */
import { describe, expect, it, vi } from 'vitest';
import { MobileError } from '../api/errors';
import {
  createGoogleGeocodingProvider,
  GOOGLE_GEOCODING_ENDPOINT,
} from './google-geocoding-provider';
import { GOOGLE_MAPS_PROVIDER_ID } from './provider-errors';

type FetchMock = (input: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fetchMock(impl: FetchMock) {
  return vi.fn<FetchMock>(impl);
}

describe('createGoogleGeocodingProvider', () => {
  it('forward-geocodes an address into LocationReferences', async () => {
    const fetchImpl = fetchMock(async () =>
      jsonResponse({
        status: 'OK',
        results: [
          {
            formatted_address: 'MG Road, Bengaluru',
            geometry: { location: { lat: 12.9716, lng: 77.5946 } },
          },
        ],
      }),
    );
    const provider = createGoogleGeocodingProvider({
      apiKey: 'key-1',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const results = await provider.forwardGeocode('  MG Road  ');
    expect(results).toEqual([
      { latitude: 12.9716, longitude: 77.5946, label: 'MG Road, Bengaluru' },
    ]);
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url.startsWith(GOOGLE_GEOCODING_ENDPOINT)).toBe(true);
    expect(url).toContain('address=MG+Road');
    expect(url).toContain('key=key-1');
    expect(provider.id).toBe(GOOGLE_MAPS_PROVIDER_ID);
  });

  it('reverse-geocodes a coordinate', async () => {
    const fetchImpl = fetchMock(async () =>
      jsonResponse({
        status: 'OK',
        results: [
          {
            formatted_address: 'Koramangala, Bengaluru',
            geometry: { location: { lat: 12.9352, lng: 77.6245 } },
          },
        ],
      }),
    );
    const provider = createGoogleGeocodingProvider({
      apiKey: 'key-1',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const reference = await provider.reverseGeocode({
      latitude: 12.9352,
      longitude: 77.6245,
    });
    expect(reference).toEqual({
      latitude: 12.9352,
      longitude: 77.6245,
      label: 'Koramangala, Bengaluru',
    });
  });

  it('resolves ZERO_RESULTS to an empty array / null (not an error)', async () => {
    const fetchImpl = fetchMock(async () =>
      jsonResponse({ status: 'ZERO_RESULTS', results: [] }),
    );
    const provider = createGoogleGeocodingProvider({
      apiKey: 'key-1',
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(provider.forwardGeocode('nowhere')).resolves.toEqual([]);
    await expect(
      provider.reverseGeocode({ latitude: 0, longitude: 0 }),
    ).resolves.toBeNull();
  });

  it('rejects a blank query as validation', async () => {
    const provider = createGoogleGeocodingProvider({
      apiKey: 'key-1',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(provider.forwardGeocode('   ')).rejects.toMatchObject({
      kind: 'validation',
    });
  });

  it('normalizes OVER_QUERY_LIMIT to rate-limited', async () => {
    const fetchImpl = fetchMock(async () =>
      jsonResponse({
        status: 'OVER_QUERY_LIMIT',
        results: [],
        error_message: 'You have exceeded your daily request quota',
      }),
    );
    const provider = createGoogleGeocodingProvider({
      apiKey: 'key-1',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const err = await provider
      .forwardGeocode('MG Road')
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MobileError);
    expect((err as MobileError).kind).toBe('rate-limited');
    expect((err as MobileError).details).toMatchObject({
      provider: GOOGLE_MAPS_PROVIDER_ID,
      status: 'OVER_QUERY_LIMIT',
    });
  });

  it('normalizes REQUEST_DENIED to permission-denied', async () => {
    const fetchImpl = fetchMock(async () =>
      jsonResponse({
        status: 'REQUEST_DENIED',
        results: [],
        error_message: 'The provided API key is invalid',
      }),
    );
    const provider = createGoogleGeocodingProvider({
      apiKey: 'bad-key',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const err = await provider
      .reverseGeocode({ latitude: 12.97, longitude: 77.59 })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as MobileError).kind).toBe('permission-denied');
  });

  it('normalizes transport failures to network', async () => {
    const fetchImpl = fetchMock(async () => {
      throw new TypeError('fetch failed');
    });
    const provider = createGoogleGeocodingProvider({
      apiKey: 'key-1',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const err = await provider
      .forwardGeocode('MG Road')
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as MobileError).kind).toBe('network');
  });
});
