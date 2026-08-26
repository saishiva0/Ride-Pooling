import { describe, expect, it } from 'vitest';
import { MobileError } from '../api/errors';
import {
  isLocationError,
  isLocationIdle,
  isLocationRequesting,
  isLocationSuccess,
  locationAcquisitionMessage,
  type LocationState,
} from './location-state';

describe('LocationState (acquisition independent of permission)', () => {
  it('supports idle / requesting / success / error', () => {
    const states: LocationState[] = [
      { status: 'idle' },
      { status: 'requesting' },
      {
        status: 'success',
        coordinate: { latitude: 12.9716, longitude: 77.5946 },
      },
      {
        status: 'error',
        error: new MobileError('location-unavailable', 'unavailable'),
      },
    ];
    expect(states.map((s) => s.status)).toEqual([
      'idle',
      'requesting',
      'success',
      'error',
    ]);
  });

  it('guards each state', () => {
    expect(isLocationIdle({ status: 'idle' })).toBe(true);
    expect(isLocationRequesting({ status: 'requesting' })).toBe(true);
    expect(
      isLocationSuccess({
        status: 'success',
        coordinate: { latitude: 0, longitude: 0 },
      }),
    ).toBe(true);
    expect(
      isLocationError({
        status: 'error',
        error: new MobileError('timeout', 'timed out'),
      }),
    ).toBe(true);
    expect(isLocationRequesting({ status: 'idle' })).toBe(false);
  });

  it('success always carries a coordinate (never an empty position)', () => {
    const success = { status: 'success' } as LocationState;
    expect(isLocationSuccess(success)).toBe(false);
  });

  it('describes the in-flight state deterministically', () => {
    expect(locationAcquisitionMessage({ status: 'requesting' })).toBe(
      'Getting your current location…',
    );
  });

  it('shows no acquisition message for settled states (errors use the normalized MobileError model)', () => {
    expect(locationAcquisitionMessage({ status: 'idle' })).toBeNull();
    expect(
      locationAcquisitionMessage({
        status: 'success',
        coordinate: { latitude: 0, longitude: 0 },
      }),
    ).toBeNull();
    expect(
      locationAcquisitionMessage({
        status: 'error',
        error: new MobileError('location-unavailable', 'unavailable'),
      }),
    ).toBeNull();
  });
});
