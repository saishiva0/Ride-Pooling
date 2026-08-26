/**
 * Unit tests for the routing provider port (Phase 3.12 §9, §20, §22).
 *
 * Proves the seam works with deterministic local fixtures: a fake provider's
 * success and failure are honored, the fail-closed default throws a
 * provider-independent error without any network access, and provider
 * failures are represented by `RoutingProviderError` (built on the existing
 * `ExternalServiceError`). No vendor, no SDK, no HTTP.
 */
import { describe, expect, it } from 'vitest';
import { ExternalServiceError } from '../../../lib/errors.js';
import type { RouteResult } from '../domain/location.types.js';
import {
  failClosedRoutingProvider,
  RoutingProviderError,
  type RoutingProvider,
} from './routing.js';

const ROUTE_REQUEST = {
  origin: { latitude: 12.9716, longitude: 77.5946 },
  destination: { latitude: 12.2958, longitude: 76.6394 },
} as const;

describe('RoutingProvider port', () => {
  it('accepts a fake provider success with explicit units and optional geometry', async () => {
    const result: RouteResult = {
      distanceMeters: 144_500,
      durationSeconds: 7_200,
      geometry: {
        type: 'LineString',
        coordinates: [
          [77.5946, 12.9716],
          [76.6394, 12.2958],
        ],
      },
    };
    const fake: RoutingProvider = {
      id: 'fake',
      calculateRoute: async () => result,
    };

    await expect(fake.calculateRoute(ROUTE_REQUEST)).resolves.toEqual(result);
    // Units are explicit by name — the port's contract.
    expect(result.distanceMeters).toBeGreaterThan(0);
    expect(result.durationSeconds).toBeGreaterThan(0);
  });

  it('propagates a fake provider failure as RoutingProviderError (not a vendor error)', async () => {
    const fake: RoutingProvider = {
      id: 'fake',
      calculateRoute: async () => {
        throw new RoutingProviderError('Upstream route service unavailable', {
          providerId: 'fake',
        });
      },
    };

    await expect(fake.calculateRoute(ROUTE_REQUEST)).rejects.toBeInstanceOf(
      RoutingProviderError,
    );
    await expect(fake.calculateRoute(ROUTE_REQUEST)).rejects.toMatchObject({
      code: 'EXTERNAL_SERVICE_ERROR',
      statusCode: 502,
      expose: false,
      providerId: 'fake',
    });
  });
});

describe('failClosedRoutingProvider (default behavior)', () => {
  it('throws a provider-independent RoutingProviderError — no network, no vendor', async () => {
    const error = await failClosedRoutingProvider
      .calculateRoute(ROUTE_REQUEST)
      .then(
        () => null,
        (err: unknown) => err,
      );

    expect(error).toBeInstanceOf(RoutingProviderError);
    expect(error).toBeInstanceOf(ExternalServiceError);
    const routingError = error as RoutingProviderError;
    expect(routingError.code).toBe('EXTERNAL_SERVICE_ERROR');
    expect(routingError.statusCode).toBe(502);
    expect(routingError.expose).toBe(false);
    expect(routingError.providerId).toBe('unconfigured');
    // The message is vendor-neutral and names the open decision.
    expect(routingError.message).toContain('OD-007');
  });

  it('never resolves — every call fails, so no fake route can be silently invented', async () => {
    await expect(
      failClosedRoutingProvider.calculateRoute(ROUTE_REQUEST),
    ).rejects.toBeInstanceOf(RoutingProviderError);
  });
});

describe('RoutingProviderError semantics', () => {
  it('is built on the existing AppError/ExternalServiceError architecture', () => {
    const error = new RoutingProviderError('boom', { providerId: 'osrm' });
    expect(error).toBeInstanceOf(ExternalServiceError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('EXTERNAL_SERVICE_ERROR');
    expect(error.statusCode).toBe(502);
    expect(error.expose).toBe(false);
    expect(error.providerId).toBe('osrm');
  });

  it('defaults providerId to unconfigured when omitted', () => {
    expect(new RoutingProviderError('boom').providerId).toBe('unconfigured');
  });
});
