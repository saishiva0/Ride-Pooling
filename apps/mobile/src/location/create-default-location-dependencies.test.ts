/**
 * Default location dependency wiring tests (Phase 3.20). Pins the fail-closed
 * behavior without a Maps key and the real-provider wiring with one.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultLocationDependencies } from './create-default-location-dependencies';
import { GOOGLE_MAPS_PROVIDER_ID } from './provider-errors';

describe('createDefaultLocationDependencies', () => {
  it('fails closed without a Maps key (no fabricated location/route)', async () => {
    const deps = createDefaultLocationDependencies({});
    expect(deps.geocodingProvider.id).toBe('fail-closed');
    expect(deps.routingProvider.id).toBe('fail-closed');
    await expect(deps.locationClient.getPermissionState()).resolves.toBe(
      'unavailable',
    );
    await expect(
      deps.geocodingProvider.forwardGeocode('MG Road'),
    ).rejects.toMatchObject({ kind: 'external-service' });
    await expect(
      deps.routingProvider.calculateRoute({
        origin: { latitude: 12.97, longitude: 77.59 },
        destination: { latitude: 12.93, longitude: 77.62 },
      }),
    ).rejects.toMatchObject({ kind: 'external-service' });
  });

  it('wires the Google providers when a key is configured', () => {
    const deps = createDefaultLocationDependencies({
      EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: 'AIza-fake',
    });
    expect(deps.geocodingProvider.id).toBe(GOOGLE_MAPS_PROVIDER_ID);
    expect(deps.routingProvider.id).toBe(GOOGLE_MAPS_PROVIDER_ID);
  });
});
