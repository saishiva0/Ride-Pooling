/**
 * Google Routes provider tests (Phase 3.20). Deterministic: `fetch` is
 * injected, so no network is ever used. Pins request construction, duration
 * parsing, polyline decoding into `LineStringGeometry`, and error
 * normalization.
 */
import { describe, expect, it, vi } from 'vitest';
import { MobileError } from '../api/errors';
import {
  createGoogleRoutingProvider,
  GOOGLE_ROUTES_ENDPOINT,
  parseGoogleDurationSeconds,
} from './google-routing-provider';
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

describe('parseGoogleDurationSeconds', () => {
  it('parses whole and fractional durations', () => {
    expect(parseGoogleDurationSeconds('1234s')).toBe(1234);
    expect(parseGoogleDurationSeconds('65.4s')).toBe(65);
    expect(parseGoogleDurationSeconds('0s')).toBe(0);
  });

  it('returns 0 for unexpected formats (geometry remains authoritative)', () => {
    expect(parseGoogleDurationSeconds(undefined)).toBe(0);
    expect(parseGoogleDurationSeconds('abc')).toBe(0);
    expect(parseGoogleDurationSeconds('')).toBe(0);
  });
});

describe('createGoogleRoutingProvider', () => {
  const request = {
    origin: { latitude: 12.9716, longitude: 77.5946 },
    destination: { latitude: 12.9352, longitude: 77.6245 },
  };

  it('calculates a route, decoding the polyline into LineString geometry', async () => {
    const fetchImpl = fetchMock(async () =>
      jsonResponse({
        routes: [
          {
            distanceMeters: 4850,
            duration: '602s',
            polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC' },
          },
        ],
      }),
    );
    const provider = createGoogleRoutingProvider({
      apiKey: 'key-1',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await provider.calculateRoute(request);
    expect(result.distanceMeters).toBe(4850);
    expect(result.durationSeconds).toBe(602);
    expect(result.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [-120.2, 38.5],
        [-120.95, 40.7],
      ],
    });
    expect(provider.id).toBe(GOOGLE_MAPS_PROVIDER_ID);

    const [url, init = {}] = fetchImpl.mock.calls[0];
    expect(url).toBe(GOOGLE_ROUTES_ENDPOINT);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('key-1');
    const sentBody = JSON.parse(String(init.body)) as {
      origin: { location: { latLng: { latitude: number } } };
    };
    expect(sentBody.origin.location.latLng.latitude).toBe(12.9716);
  });

  it('omits geometry when fewer than two points are decoded', async () => {
    const fetchImpl = fetchMock(async () =>
      jsonResponse({
        routes: [{ distanceMeters: 100, duration: '10s', polyline: {} }],
      }),
    );
    const provider = createGoogleRoutingProvider({
      apiKey: 'key-1',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await provider.calculateRoute(request);
    expect(result.geometry).toBeUndefined();
    expect(result.distanceMeters).toBe(100);
  });

  it('throws a normalized not-found error when no route exists', async () => {
    const fetchImpl = fetchMock(async () => jsonResponse({ routes: [] }));
    const provider = createGoogleRoutingProvider({
      apiKey: 'key-1',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const err = await provider
      .calculateRoute(request)
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as MobileError).kind).toBe('not-found');
  });

  it('normalizes API error payloads', async () => {
    const fetchImpl = fetchMock(async () =>
      jsonResponse({
        error: {
          code: 403,
          status: 'PERMISSION_DENIED',
          message: 'The caller does not have permission',
        },
      }),
    );
    const provider = createGoogleRoutingProvider({
      apiKey: 'bad-key',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const err = await provider
      .calculateRoute(request)
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as MobileError).kind).toBe('permission-denied');
  });

  it('normalizes RESOURCE_EXHAUSTED to rate-limited', async () => {
    const fetchImpl = fetchMock(async () =>
      jsonResponse({
        error: { status: 'RESOURCE_EXHAUSTED', message: 'quota exceeded' },
      }),
    );
    const provider = createGoogleRoutingProvider({
      apiKey: 'key-1',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const err = await provider
      .calculateRoute(request)
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as MobileError).kind).toBe('rate-limited');
  });

  it('normalizes HTTP error responses to external-service', async () => {
    const fetchImpl = fetchMock(
      async () => new Response('oops', { status: 500 }),
    );
    const provider = createGoogleRoutingProvider({
      apiKey: 'key-1',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const err = await provider
      .calculateRoute(request)
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as MobileError).kind).toBe('external-service');
  });

  it('normalizes transport failures to network', async () => {
    const fetchImpl = fetchMock(async () => {
      throw new TypeError('fetch failed');
    });
    const provider = createGoogleRoutingProvider({
      apiKey: 'key-1',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const err = await provider
      .calculateRoute(request)
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as MobileError).kind).toBe('network');
  });
});
