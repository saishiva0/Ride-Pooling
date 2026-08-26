/**
 * Unit tests for the geocoding provider seam (Phase 3.12 §10, §20, §22).
 *
 * Proves the seam works with deterministic local fixtures: a fake provider's
 * forward/reverse success and failure are honored, the fail-closed default
 * throws a provider-independent error without any network access, and
 * provider failures are represented by `GeocodingProviderError` (built on the
 * existing `ExternalServiceError`). No vendor, no SDK, no HTTP, no API keys.
 */
import { describe, expect, it } from 'vitest';
import { ExternalServiceError } from '../../../lib/errors.js';
import type { LocationReference } from '../domain/location.types.js';
import {
  failClosedGeocodingProvider,
  GeocodingProviderError,
  type GeocodingProvider,
} from './geocoding.js';

const COORDINATE = { latitude: 12.9716, longitude: 77.5946 } as const;

describe('GeocodingProvider port', () => {
  it('accepts a fake provider forward-geocode success returning LocationReference[]', async () => {
    const results: LocationReference[] = [
      { latitude: 12.9716, longitude: 77.5946, label: 'MG Road, Bengaluru' },
    ];
    const fake: GeocodingProvider = {
      id: 'fake',
      forwardGeocode: async () => results,
      reverseGeocode: async () => null,
    };

    await expect(fake.forwardGeocode('MG Road Bengaluru')).resolves.toEqual(
      results,
    );
    // Contract shape: lat/lng + optional label only — no vendor payloads.
    expect(results[0]).toMatchObject({
      latitude: 12.9716,
      longitude: 77.5946,
      label: 'MG Road, Bengaluru',
    });
  });

  it('accepts a fake provider reverse-geocode success (and null when undescribable)', async () => {
    const fake: GeocodingProvider = {
      id: 'fake',
      forwardGeocode: async () => [],
      reverseGeocode: async (coordinate) =>
        coordinate.latitude === COORDINATE.latitude
          ? {
              latitude: coordinate.latitude,
              longitude: coordinate.longitude,
              label: 'Bengaluru',
            }
          : null,
    };

    await expect(fake.reverseGeocode(COORDINATE)).resolves.toMatchObject({
      latitude: 12.9716,
      longitude: 77.5946,
      label: 'Bengaluru',
    });
    await expect(
      fake.reverseGeocode({ latitude: 0, longitude: 0 }),
    ).resolves.toBeNull();
  });

  it('propagates a fake provider failure as GeocodingProviderError (not a vendor error)', async () => {
    const fake: GeocodingProvider = {
      id: 'fake',
      forwardGeocode: async () => {
        throw new GeocodingProviderError('Upstream geocoder unavailable', {
          providerId: 'fake',
        });
      },
      reverseGeocode: async () => null,
    };

    await expect(fake.forwardGeocode('anything')).rejects.toMatchObject({
      code: 'EXTERNAL_SERVICE_ERROR',
      statusCode: 502,
      expose: false,
      providerId: 'fake',
    });
  });
});

describe('failClosedGeocodingProvider (default behavior)', () => {
  it('throws a provider-independent GeocodingProviderError for forward geocoding', async () => {
    const error = await failClosedGeocodingProvider
      .forwardGeocode('MG Road Bengaluru')
      .then(
        () => null,
        (err: unknown) => err,
      );

    expect(error).toBeInstanceOf(GeocodingProviderError);
    expect(error).toBeInstanceOf(ExternalServiceError);
    const geocodingError = error as GeocodingProviderError;
    expect(geocodingError.code).toBe('EXTERNAL_SERVICE_ERROR');
    expect(geocodingError.statusCode).toBe(502);
    expect(geocodingError.expose).toBe(false);
    expect(geocodingError.providerId).toBe('unconfigured');
    expect(geocodingError.message).toContain('OD-007');
  });

  it('throws a provider-independent GeocodingProviderError for reverse geocoding', async () => {
    await expect(
      failClosedGeocodingProvider.reverseGeocode(COORDINATE),
    ).rejects.toBeInstanceOf(GeocodingProviderError);
  });

  it('never resolves — no geocode result can be silently invented', async () => {
    await expect(
      failClosedGeocodingProvider.forwardGeocode('anything'),
    ).rejects.toBeInstanceOf(GeocodingProviderError);
  });
});

describe('GeocodingProviderError semantics', () => {
  it('is built on the existing AppError/ExternalServiceError architecture', () => {
    const error = new GeocodingProviderError('boom', {
      providerId: 'nominatim',
    });
    expect(error).toBeInstanceOf(ExternalServiceError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('EXTERNAL_SERVICE_ERROR');
    expect(error.statusCode).toBe(502);
    expect(error.expose).toBe(false);
    expect(error.providerId).toBe('nominatim');
  });

  it('defaults providerId to unconfigured when omitted', () => {
    expect(new GeocodingProviderError('boom').providerId).toBe('unconfigured');
  });
});
