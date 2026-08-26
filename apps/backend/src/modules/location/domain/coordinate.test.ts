/**
 * Unit tests for the centralized coordinate validation, normalization, and
 * GeoJSON serialization (Phase 3.12).
 *
 * Pure functions — no database, no network, no framework. Covers the full
 * Phase 3.12 test matrix for coordinates: valid / invalid / boundary values,
 * NaN, ±Infinity, deterministic output, and the mandatory longitude-first
 * GeoJSON ordering regression at the new serialization boundary (the Phase
 * 3.3 discovery integration test already pins the same order at the PostGIS
 * boundary; this pins the pure serialization layer).
 */
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../lib/errors.js';
import {
  asCoordinate,
  assertValidCoordinate,
  isValidCoordinate,
  isValidLatitude,
  isValidLongitude,
  toGeoJsonPoint,
} from './coordinate.js';
import type { Coordinate } from './location.types.js';

function point(latitude: number, longitude: number): Coordinate {
  return { latitude, longitude };
}

describe('isValidLatitude', () => {
  it('accepts the valid minimum boundary (-90)', () => {
    expect(isValidLatitude(-90)).toBe(true);
  });

  it('accepts the valid maximum boundary (90)', () => {
    expect(isValidLatitude(90)).toBe(true);
  });

  it('accepts typical mid-range values', () => {
    expect(isValidLatitude(0)).toBe(true);
    expect(isValidLatitude(12.9716)).toBe(true);
    expect(isValidLatitude(-33.8688)).toBe(true);
  });

  it('rejects values below the minimum', () => {
    expect(isValidLatitude(-90.0001)).toBe(false);
    expect(isValidLatitude(-200)).toBe(false);
  });

  it('rejects values above the maximum', () => {
    expect(isValidLatitude(90.0001)).toBe(false);
    expect(isValidLatitude(200)).toBe(false);
  });

  it('rejects NaN and ±Infinity', () => {
    expect(isValidLatitude(Number.NaN)).toBe(false);
    expect(isValidLatitude(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidLatitude(Number.NEGATIVE_INFINITY)).toBe(false);
  });
});

describe('isValidLongitude', () => {
  it('accepts the valid minimum boundary (-180)', () => {
    expect(isValidLongitude(-180)).toBe(true);
  });

  it('accepts the valid maximum boundary (180)', () => {
    expect(isValidLongitude(180)).toBe(true);
  });

  it('accepts typical mid-range values', () => {
    expect(isValidLongitude(0)).toBe(true);
    expect(isValidLongitude(77.5946)).toBe(true);
    expect(isValidLongitude(-151.2093)).toBe(true);
  });

  it('rejects values below the minimum', () => {
    expect(isValidLongitude(-180.0001)).toBe(false);
    expect(isValidLongitude(-200)).toBe(false);
  });

  it('rejects values above the maximum', () => {
    expect(isValidLongitude(180.0001)).toBe(false);
    expect(isValidLongitude(200)).toBe(false);
  });

  it('rejects NaN and ±Infinity', () => {
    expect(isValidLongitude(Number.NaN)).toBe(false);
    expect(isValidLongitude(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidLongitude(Number.NEGATIVE_INFINITY)).toBe(false);
  });
});

describe('isValidCoordinate', () => {
  it('accepts a valid pair', () => {
    expect(isValidCoordinate(point(12.9716, 77.5946))).toBe(true);
  });

  it('accepts boundary values in both axes', () => {
    expect(isValidCoordinate(point(90, 180))).toBe(true);
    expect(isValidCoordinate(point(-90, -180))).toBe(true);
  });

  it('rejects an invalid latitude', () => {
    expect(isValidCoordinate(point(91, 77.5946))).toBe(false);
    expect(isValidCoordinate(point(Number.NaN, 77.5946))).toBe(false);
  });

  it('rejects an invalid longitude', () => {
    expect(isValidCoordinate(point(12.9716, 181))).toBe(false);
    expect(isValidCoordinate(point(12.9716, Number.POSITIVE_INFINITY))).toBe(
      false,
    );
  });

  it('rejects a pair where both components are invalid', () => {
    expect(isValidCoordinate(point(Number.NaN, Number.NaN))).toBe(false);
  });
});

describe('assertValidCoordinate', () => {
  it('does not throw for a valid coordinate', () => {
    expect(() => assertValidCoordinate(point(12.9716, 77.5946))).not.toThrow();
  });

  it('throws ValidationError (400) with the latitude field path for a bad latitude', () => {
    try {
      assertValidCoordinate(point(91, 77.5946), 'pickup');
      throw new Error('expected assertValidCoordinate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const validationErr = err as Error & {
        code: string;
        statusCode: number;
        field?: string;
      };
      expect(validationErr.code).toBe('VALIDATION_ERROR');
      expect(validationErr.statusCode).toBe(400);
      expect(validationErr.field).toBe('pickup.latitude');
    }
  });

  it('throws ValidationError with the longitude field path for a bad longitude', () => {
    try {
      assertValidCoordinate(point(12.9716, -181), 'destination');
      throw new Error('expected assertValidCoordinate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as Error & { field?: string }).field).toBe(
        'destination.longitude',
      );
    }
  });

  it('throws for NaN and Infinity', () => {
    expect(() => assertValidCoordinate(point(Number.NaN, 0))).toThrow(
      ValidationError,
    );
    expect(() =>
      assertValidCoordinate(point(0, Number.POSITIVE_INFINITY)),
    ).toThrow(ValidationError);
  });
});

describe('asCoordinate (normalization)', () => {
  it('returns the coordinate unchanged for valid input', () => {
    const input = point(12.9716, 77.5946);
    expect(asCoordinate(input)).toEqual(input);
  });

  it('does not round, truncate, or alter precision of valid values', () => {
    const input = point(12.9716123456789, 77.5946123456789);
    expect(asCoordinate(input)).toEqual(input);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => asCoordinate(point(Number.NaN, 77.5946))).toThrow(
      ValidationError,
    );
    expect(() =>
      asCoordinate(point(12.9716, Number.NEGATIVE_INFINITY)),
    ).toThrow(ValidationError);
  });

  it('rejects out-of-range values', () => {
    expect(() => asCoordinate(point(90.0001, 0))).toThrow(ValidationError);
    expect(() => asCoordinate(point(0, -180.0001))).toThrow(ValidationError);
  });
});

describe('toGeoJsonPoint (serialization)', () => {
  it('produces a valid GeoJSON Point with the correct type', () => {
    expect(toGeoJsonPoint(point(12.9716, 77.5946)).type).toBe('Point');
  });

  it('coordinate order regression: longitude first, latitude second', () => {
    // The mandatory ordering check: longitude = X, latitude = Y must map to
    // [X, Y] — mirroring the PostGIS ST_MakePoint(longitude, latitude)
    // convention, NOT [Y, X].
    const longitude = 77.5946;
    const latitude = 12.9716;
    expect(toGeoJsonPoint(point(latitude, longitude)).coordinates).toEqual([
      longitude,
      latitude,
    ]);
  });

  it('is deterministic: same input always yields the same output', () => {
    const input = point(12.9716, 77.5946);
    expect(toGeoJsonPoint(input)).toEqual(toGeoJsonPoint(input));
    expect(toGeoJsonPoint(input)).toEqual({
      type: 'Point',
      coordinates: [77.5946, 12.9716],
    });
  });

  it('accepts boundary coordinates', () => {
    expect(toGeoJsonPoint(point(90, 180)).coordinates).toEqual([180, 90]);
    expect(toGeoJsonPoint(point(-90, -180)).coordinates).toEqual([-180, -90]);
  });

  it('throws ValidationError for invalid input (NaN, Infinity, out of range)', () => {
    expect(() => toGeoJsonPoint(point(Number.NaN, 0))).toThrow(ValidationError);
    expect(() => toGeoJsonPoint(point(0, Number.POSITIVE_INFINITY))).toThrow(
      ValidationError,
    );
    expect(() => toGeoJsonPoint(point(91, 0))).toThrow(ValidationError);
  });
});
