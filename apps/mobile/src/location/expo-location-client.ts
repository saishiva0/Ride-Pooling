/**
 * Expo Location adapter — the real device-location `LocationClient` (Phase
 * 3.20 — GOOGLE MAPS & LOCATION INTEGRATION).
 *
 * Wraps the `expo-location` native module behind the provider-neutral
 * `LocationClient` port (`location-client.ts`). Screens and hooks never touch
 * Expo Location directly. Every native failure is normalized to a
 * `MobileError` before crossing the boundary.
 *
 * The native module is injectable (`createExpoLocationClient({ module })`) so
 * tests can supply a deterministic fake native module; production uses the
 * real `expo-location` module by default. When the module is unavailable at
 * runtime (native module missing), the client fails closed — permission is
 * `unavailable` and acquisition throws a normalized `location-unavailable`
 * error.
 *
 * Integration notes:
 * - Foreground permission only (background location is outside the V1 scope).
 * - One-shot `getCurrentPositionAsync`; no continuous subscription (the
 *   `LocationClient` port deliberately omits `watchLocation`).
 */
import * as ExpoLocation from 'expo-location';
import { MobileError } from '../api/errors';
import type { LocationClient } from './location-client';
import type { Coordinate } from './location.types';
import type { LocationPermissionStatus } from './permission';

/**
 * The subset of the `expo-location` module used by this adapter. Injectable so
 * tests never import the native module.
 */
export interface ExpoLocationNativeModule {
  getForegroundPermissionsAsync(): Promise<{
    status: string;
    granted: boolean;
  }>;
  requestForegroundPermissionsAsync(): Promise<{
    status: string;
    granted: boolean;
  }>;
  hasServicesEnabledAsync(): Promise<boolean>;
  getCurrentPositionAsync(options?: {
    accuracy?: number;
    timeout?: number;
  }): Promise<{ coords: { latitude: number; longitude: number } }>;
  Accuracy: { Balanced: number };
}

function permissionStatusFromNative(status: string): LocationPermissionStatus {
  switch (status) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'undetermined':
      return 'unknown';
    default:
      return 'unavailable';
  }
}

function normalizeAcquisitionError(err: unknown): MobileError {
  if (err instanceof MobileError) {
    return err;
  }
  if (err instanceof Error) {
    const name = err.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return new MobileError('timeout', 'Location request timed out', {
        cause: err,
      });
    }
  }
  return new MobileError(
    'location-unavailable',
    'Could not determine location',
    {
      cause: err,
    },
  );
}

/**
 * Creates the real device-location client. `module` defaults to the real
 * `expo-location`; tests inject a fake native module.
 */
export function createExpoLocationClient(options?: {
  module?: ExpoLocationNativeModule;
  /** Timeout for `getCurrentPositionAsync` in milliseconds. Default 10s. */
  timeoutMs?: number;
}): LocationClient {
  const module = options?.module ?? ExpoLocation;
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const hasNativeModule = typeof module.getCurrentPositionAsync === 'function';

  const failClosed: LocationClient = {
    async getPermissionState(): Promise<LocationPermissionStatus> {
      return 'unavailable';
    },
    async requestPermission(): Promise<LocationPermissionStatus> {
      return 'unavailable';
    },
    async getCurrentLocation(): Promise<Coordinate> {
      throw new MobileError(
        'location-unavailable',
        'Device location is unavailable (no native location module)',
        {
          details: { provider: 'expo-location', reason: 'unavailable-module' },
        },
      );
    },
  };

  if (!hasNativeModule) {
    return failClosed;
  }

  return {
    async getPermissionState(): Promise<LocationPermissionStatus> {
      try {
        const response = await module.getForegroundPermissionsAsync();
        return permissionStatusFromNative(response.status);
      } catch {
        return 'unavailable';
      }
    },
    async requestPermission(): Promise<LocationPermissionStatus> {
      try {
        const response = await module.requestForegroundPermissionsAsync();
        return permissionStatusFromNative(response.status);
      } catch {
        return 'unavailable';
      }
    },
    async getCurrentLocation(): Promise<Coordinate> {
      try {
        const response = await module.getCurrentPositionAsync({
          accuracy: module.Accuracy.Balanced,
          timeout: timeoutMs,
        });
        const { latitude, longitude } = response.coords;
        if (
          typeof latitude !== 'number' ||
          typeof longitude !== 'number' ||
          Number.isNaN(latitude) ||
          Number.isNaN(longitude)
        ) {
          throw new MobileError(
            'location-unavailable',
            'Location provider returned an invalid coordinate',
            {
              details: { provider: 'expo-location', reason: 'invalid-coords' },
            },
          );
        }
        return { latitude, longitude };
      } catch (err) {
        throw normalizeAcquisitionError(err);
      }
    },
  };
}
