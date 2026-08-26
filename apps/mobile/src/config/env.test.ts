/**
 * Mobile config resolution tests (Phase 3.13; Phase 3.20 adds the Google Maps
 * key). Deterministic — no reliance on the ambient process environment.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API_BASE_URL,
  loadMobileConfig,
  resolveApiBaseUrl,
  resolveGoogleMapsApiKey,
} from './env';

describe('resolveApiBaseUrl', () => {
  it('falls back to the local development default when unset', () => {
    expect(resolveApiBaseUrl(undefined)).toBe(DEFAULT_API_BASE_URL);
    expect(resolveApiBaseUrl('')).toBe(DEFAULT_API_BASE_URL);
    expect(resolveApiBaseUrl('   ')).toBe(DEFAULT_API_BASE_URL);
  });

  it('trims trailing slashes for deterministic URL building', () => {
    expect(resolveApiBaseUrl('https://api.ridepool.app/')).toBe(
      'https://api.ridepool.app',
    );
    expect(resolveApiBaseUrl(' https://api.ridepool.app/// ')).toBe(
      'https://api.ridepool.app',
    );
  });
});

describe('resolveGoogleMapsApiKey', () => {
  it('returns null when unset or blank', () => {
    expect(resolveGoogleMapsApiKey(undefined)).toBeNull();
    expect(resolveGoogleMapsApiKey('')).toBeNull();
    expect(resolveGoogleMapsApiKey('   ')).toBeNull();
  });

  it('trims and returns a configured key', () => {
    expect(resolveGoogleMapsApiKey('  AIza-SyA  ')).toBe('AIza-SyA');
  });
});

describe('loadMobileConfig', () => {
  it('defaults realtime off and the maps key to null', () => {
    const config = loadMobileConfig({});
    expect(config.realtimeUrl).toBeNull();
    expect(config.googleMapsApiKey).toBeNull();
  });

  it('reads the Google Maps API key from EXPO_PUBLIC_GOOGLE_MAPS_API_KEY', () => {
    const config = loadMobileConfig({
      EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: ' AIza-fake ',
    });
    expect(config.googleMapsApiKey).toBe('AIza-fake');
  });

  it('strips trailing slashes from the realtime URL', () => {
    const config = loadMobileConfig({
      EXPO_PUBLIC_REALTIME_URL: 'ws://localhost:4000/ws/',
    });
    expect(config.realtimeUrl).toBe('ws://localhost:4000/ws');
  });
});
