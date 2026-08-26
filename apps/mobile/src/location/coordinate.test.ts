import { describe, expect, it } from 'vitest';
import { MobileError } from '../api/errors';
import {
  LATITUDE_MAX,
  LATITUDE_MIN,
  LONGITUDE_MAX,
  LONGITUDE_MIN,
  asCoordinate,
  asLocationReference,
  assertValidCoordinate,
  formatLocationReference,
  isValidCoordinate,
  isValidLatitude,
  isValidLongitude,
  toGeoJsonPoint,
} from './coordinate';
import type { Coordinate } from './location.types';

const BENGALURU: Coordinate = { latitude: 12.9716, longitude: 77.5946 };
const ZERO: Coordinate = { latitude: 0, longitude: 0 };

describe('isValidLatitude / isValidLongitude (WGS84 bounds)', () => {
  it('accepts the exact WGS84 boundary values', () => {
    expect(isValidLatitude(LATITUDE_MIN)).toBe(true);
    expect(isValidLatitude(LATITUDE_MAX)).toBe(true);
    expect(isValidLongitude(LONGITUDE_MIN)).toBe(true);
    expect(isValidLongitude(LONGITUDE_MAX)).toBe(true);
  });

  it('accepts a known valid coordinate pair', () => {
    expect(isValidLatitude(12.9716)).toBe(true);
    expect(isValidLongitude(77.5946)).toBe(true);
    expect(isValidCoordinate(BENGALURU)).toBe(true);
  });

  it('accepts the zero coordinate (0, 0)', () => {
    expect(isValidCoordinate(ZERO)).toBe(true);
  });

  it('rejects out-of-range latitudes', () => {
    expect(isValidLatitude(91)).toBe(false);
    expect(isValidLatitude(-91)).toBe(false);
  });

  it('rejects out-of-range longitudes', () => {
    expect(isValidLongitude(181)).toBe(false);
    expect(isValidLongitude(-181)).toBe(false);
  });

  it('rejects NaN', () => {
    expect(isValidLatitude(NaN)).toBe(false);
    expect(isValidLongitude(NaN)).toBe(false);
    expect(isValidCoordinate({ latitude: NaN, longitude: 0 })).toBe(false);
    expect(isValidCoordinate({ latitude: 0, longitude: NaN })).toBe(false);
  });

  it('rejects +Infinity and -Infinity', () => {
    expect(isValidLatitude(Infinity)).toBe(false);
    expect(isValidLatitude(-Infinity)).toBe(false);
    expect(isValidLongitude(Infinity)).toBe(false);
    expect(isValidLongitude(-Infinity)).toBe(false);
  });

  it('rejects a pair where only one axis is valid', () => {
    expect(isValidCoordinate({ latitude: 12.9716, longitude: 999 })).toBe(
      false,
    );
  });
});

describe('assertValidCoordinate', () => {
  it('throws a normalized validation MobileError for a bad latitude', () => {
    expect(() => assertValidCoordinate({ latitude: 91, longitude: 0 })).toThrow(
      MobileError,
    );
    try {
      assertValidCoordinate({ latitude: 91, longitude: 0 }, 'pickup');
    } catch (err) {
      const error = err as MobileError;
      expect(error.kind).toBe('validation');
      expect(error.field).toBe('pickup.latitude');
      expect(error.message).toContain('latitude must be a finite number');
    }
  });

  it('throws a normalized validation MobileError for a bad longitude', () => {
    try {
      assertValidCoordinate({ latitude: 0, longitude: -181 }, 'destination');
    } catch (err) {
      const error = err as MobileError;
      expect(error.kind).toBe('validation');
      expect(error.field).toBe('destination.longitude');
      expect(error.message).toContain('longitude must be a finite number');
    }
  });

  it('does not throw for a valid coordinate', () => {
    expect(() => assertValidCoordinate(BENGALURU)).not.toThrow();
  });
});

describe('asCoordinate', () => {
  it('returns a valid coordinate unchanged (no rounding, no precision policy)', () => {
    expect(
      asCoordinate({ latitude: 12.971654321, longitude: 77.594654321 }),
    ).toEqual({ latitude: 12.971654321, longitude: 77.594654321 });
  });

  it('throws on invalid input', () => {
    expect(() => asCoordinate({ latitude: NaN, longitude: 0 })).toThrow(
      MobileError,
    );
  });
});

describe('toGeoJsonPoint (serialization boundary — coordinate order)', () => {
  it('serializes to a GeoJSON Point with [longitude, latitude] order', () => {
    expect(toGeoJsonPoint(BENGALURU)).toEqual({
      type: 'Point',
      coordinates: [77.5946, 12.9716],
    });
  });

  it('never reverses the coordinate order (regression)', () => {
    const point = toGeoJsonPoint({ latitude: 12.9716, longitude: 77.5946 });
    expect(point.coordinates[0]).toBe(77.5946);
    expect(point.coordinates[1]).toBe(12.9716);
    expect(point.coordinates).not.toEqual([12.9716, 77.5946]);
  });

  it('is deterministic for identical input', () => {
    expect(toGeoJsonPoint(ZERO)).toEqual(toGeoJsonPoint(ZERO));
    expect(toGeoJsonPoint(ZERO).coordinates).toEqual([0, 0]);
  });

  it('rejects invalid input', () => {
    expect(() => toGeoJsonPoint({ latitude: 91, longitude: 0 })).toThrow(
      MobileError,
    );
  });
});

describe('asLocationReference / formatLocationReference', () => {
  it('maps a labeled location to the LocationReference contract', () => {
    expect(
      asLocationReference({
        latitude: 12.9716,
        longitude: 77.5946,
        label: 'MG Road',
      }),
    ).toEqual({ latitude: 12.9716, longitude: 77.5946, label: 'MG Road' });
  });

  it('drops a null/undefined label', () => {
    expect(
      asLocationReference({
        latitude: 12.9716,
        longitude: 77.5946,
        label: null,
      }),
    ).toEqual({ latitude: 12.9716, longitude: 77.5946 });
  });

  it('formats with the label when present', () => {
    expect(
      formatLocationReference(
        asLocationReference({
          latitude: 1,
          longitude: 2,
          label: 'Koramangala',
        }),
      ),
    ).toBe('Koramangala');
  });

  it('falls back to "latitude, longitude" when the label is missing', () => {
    expect(
      formatLocationReference(
        asLocationReference({ latitude: 1, longitude: 2 }),
      ),
    ).toBe('1, 2');
  });

  it('rejects an invalid location', () => {
    expect(() =>
      asLocationReference({ latitude: 999, longitude: 2, label: 'bad' }),
    ).toThrow(MobileError);
  });
});
