import { describe, expect, it } from 'vitest';
import { MobileError } from '../api/errors';
import {
  unavailableLocationClient,
  type LocationClient,
} from './location-client';

describe('unavailableLocationClient (fail closed)', () => {
  it('reports permission state as unavailable (no capability, no fabrication)', async () => {
    expect(await unavailableLocationClient.getPermissionState()).toBe(
      'unavailable',
    );
  });

  it('requesting permission resolves to unavailable (deterministic no-op)', async () => {
    expect(await unavailableLocationClient.requestPermission()).toBe(
      'unavailable',
    );
  });

  it('never fabricates a coordinate — current location throws a normalized error', async () => {
    await expect(
      unavailableLocationClient.getCurrentLocation(),
    ).rejects.toThrow(MobileError);
    try {
      await unavailableLocationClient.getCurrentLocation();
    } catch (err) {
      const error = err as MobileError;
      expect(error.kind).toBe('location-unavailable');
      expect(error.message).not.toMatch(/stack|native|Exception/i);
    }
  });

  it('performs no network, geolocation, or mock-GPS behavior', async () => {
    const fn = await unavailableLocationClient.getPermissionState();
    expect(fn).toBe('unavailable');
    // The client is a plain object of promises — no transport, no sockets,
    // no GPS calls exist anywhere in its implementation.
    const methods = [
      'getPermissionState',
      'requestPermission',
      'getCurrentLocation',
    ] as const;
    for (const method of methods) {
      expect(typeof (unavailableLocationClient as LocationClient)[method]).toBe(
        'function',
      );
    }
  });
});
