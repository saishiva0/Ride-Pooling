import { describe, expect, it } from 'vitest';
import {
  isLocationPermissionDenied,
  isLocationPermissionGranted,
  isLocationPermissionUnavailable,
  locationPermissionMessage,
  type LocationPermissionStatus,
} from './permission';

describe('LocationPermissionStatus model', () => {
  it('distinguishes the five explicit states', () => {
    const states: LocationPermissionStatus[] = [
      'unknown',
      'requesting',
      'granted',
      'denied',
      'unavailable',
    ];
    expect(states).toHaveLength(5);
  });

  it('guards granted / denied / unavailable', () => {
    expect(isLocationPermissionGranted('granted')).toBe(true);
    expect(isLocationPermissionGranted('denied')).toBe(false);
    expect(isLocationPermissionDenied('denied')).toBe(true);
    expect(isLocationPermissionDenied('granted')).toBe(false);
    expect(isLocationPermissionUnavailable('unavailable')).toBe(true);
    expect(isLocationPermissionUnavailable('denied')).toBe(false);
  });
});

describe('locationPermissionMessage (deterministic, user-understandable)', () => {
  it('explains a denied permission without blocking the manual flow', () => {
    expect(locationPermissionMessage('denied')).toBe(
      'Location permission was denied. You can still enter coordinates manually.',
    );
  });

  it('explains an unavailable capability without blocking the manual flow', () => {
    expect(locationPermissionMessage('unavailable')).toBe(
      'Location is not available on this device. You can still enter coordinates manually.',
    );
  });

  it('describes an in-flight permission request', () => {
    expect(locationPermissionMessage('requesting')).toBe(
      'Requesting location permission…',
    );
  });

  it('shows nothing for unknown and granted', () => {
    expect(locationPermissionMessage('unknown')).toBeNull();
    expect(locationPermissionMessage('granted')).toBeNull();
  });

  it('never leaks native/provider detail', () => {
    for (const status of [
      'unknown',
      'requesting',
      'granted',
      'denied',
      'unavailable',
    ] as const) {
      const message = locationPermissionMessage(status);
      if (message !== null) {
        expect(message).not.toMatch(/stack|native|provider|Exception/i);
      }
    }
  });
});
