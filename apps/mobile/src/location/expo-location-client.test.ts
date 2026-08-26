/**
 * Expo Location adapter tests (Phase 3.20). The native module is injected, so
 * no native code runs. Pins permission normalization, acquisition behavior,
 * and fail-closed handling.
 */
import { describe, expect, it, vi } from 'vitest';
import { MobileError } from '../api/errors';
import {
  createExpoLocationClient,
  type ExpoLocationNativeModule,
} from './expo-location-client';

function fakeModule(
  overrides: Partial<ExpoLocationNativeModule> = {},
): ExpoLocationNativeModule {
  return {
    getForegroundPermissionsAsync: vi.fn(async () => ({
      status: 'granted',
      granted: true,
    })),
    requestForegroundPermissionsAsync: vi.fn(async () => ({
      status: 'granted',
      granted: true,
    })),
    hasServicesEnabledAsync: vi.fn(async () => true),
    getCurrentPositionAsync: vi.fn(async () => ({
      coords: { latitude: 12.9716, longitude: 77.5946 },
    })),
    Accuracy: { Balanced: 3 },
    ...overrides,
  };
}

describe('createExpoLocationClient', () => {
  it('reports granted permission state', async () => {
    const client = createExpoLocationClient({ module: fakeModule() });
    await expect(client.getPermissionState()).resolves.toBe('granted');
  });

  it('maps native statuses to the permission model', async () => {
    const denied = createExpoLocationClient({
      module: fakeModule({
        getForegroundPermissionsAsync: vi.fn(async () => ({
          status: 'denied',
          granted: false,
        })),
      }),
    });
    await expect(denied.getPermissionState()).resolves.toBe('denied');

    const undetermined = createExpoLocationClient({
      module: fakeModule({
        getForegroundPermissionsAsync: vi.fn(async () => ({
          status: 'undetermined',
          granted: false,
        })),
      }),
    });
    await expect(undetermined.getPermissionState()).resolves.toBe('unknown');
  });

  it('acquires the current coordinate', async () => {
    const client = createExpoLocationClient({ module: fakeModule() });
    await expect(client.getCurrentLocation()).resolves.toEqual({
      latitude: 12.9716,
      longitude: 77.5946,
    });
  });

  it('passes a timeout and balanced accuracy to the native call', async () => {
    const module = fakeModule();
    const client = createExpoLocationClient({ module, timeoutMs: 5000 });
    await client.getCurrentLocation();
    expect(module.getCurrentPositionAsync).toHaveBeenCalledWith({
      accuracy: 3,
      timeout: 5000,
    });
  });

  it('normalizes invalid coordinates to location-unavailable (never a fake position)', async () => {
    const module = fakeModule({
      getCurrentPositionAsync: vi.fn(async () => ({
        coords: { latitude: Number.NaN, longitude: 77.5946 },
      })),
    });
    const client = createExpoLocationClient({ module });
    const err = await client
      .getCurrentLocation()
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as MobileError).kind).toBe('location-unavailable');
  });

  it('normalizes native acquisition failures to location-unavailable', async () => {
    const module = fakeModule({
      getCurrentPositionAsync: vi.fn(async () => {
        throw new Error('position not available');
      }),
    });
    const client = createExpoLocationClient({ module });
    const err = await client
      .getCurrentLocation()
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as MobileError).kind).toBe('location-unavailable');
    expect(err as MobileError).toBeInstanceOf(MobileError);
  });

  it('fails closed when the native module is unavailable', async () => {
    const client = createExpoLocationClient({
      module: {} as ExpoLocationNativeModule,
    });
    await expect(client.getPermissionState()).resolves.toBe('unavailable');
    await expect(client.getCurrentLocation()).rejects.toMatchObject({
      kind: 'location-unavailable',
    });
  });

  it('fail-closed requestPermission never fabricates a grant', async () => {
    const client = createExpoLocationClient({
      module: {} as ExpoLocationNativeModule,
    });
    await expect(client.requestPermission()).resolves.toBe('unavailable');
  });
});
