/**
 * Unit tests for the provider-independent distance service (Phase 3.12).
 *
 * Verifies that the default provider REUSES the authoritative Phase 3.4
 * great-circle implementation (same values, no second algorithm), that the
 * service is deterministic and symmetric with explicit meter units, and that
 * the provider port is injectable (a fake provider is honored). No database,
 * no network, no provider SDK.
 */
import { describe, expect, it } from 'vitest';
import { greatCircleDistanceMeters } from '../../ride/domain/matching/distance.js';
import {
  calculateDistanceMeters,
  greatCircleDistanceProvider,
  type DistanceProvider,
} from './distance.js';
import type { Coordinate } from '../domain/location.types.js';

function point(latitude: number, longitude: number): Coordinate {
  return { latitude, longitude };
}

const BENGALURU = point(12.9716, 77.5946);
const MYSURU = point(12.2958, 76.6394);

describe('greatCircleDistanceProvider', () => {
  it('delegates to the authoritative Phase 3.4 great-circle implementation (no second algorithm)', () => {
    // Reuse guarantee: the provider must produce EXACTLY the values the
    // authoritative function produces — not an approximate reimplementation.
    expect(greatCircleDistanceProvider.distanceMeters(BENGALURU, MYSURU)).toBe(
      greatCircleDistanceMeters(BENGALURU, MYSURU),
    );
    expect(
      greatCircleDistanceProvider.distanceMeters(point(0, 0), point(1, 0)),
    ).toBe(greatCircleDistanceMeters(point(0, 0), point(1, 0)));
  });

  it('returns 0 for the same coordinate', () => {
    expect(
      greatCircleDistanceProvider.distanceMeters(BENGALURU, BENGALURU),
    ).toBe(0);
  });

  it('is symmetric', () => {
    expect(greatCircleDistanceProvider.distanceMeters(BENGALURU, MYSURU)).toBe(
      greatCircleDistanceProvider.distanceMeters(MYSURU, BENGALURU),
    );
  });

  it('is deterministic', () => {
    const a = greatCircleDistanceProvider.distanceMeters(BENGALURU, MYSURU);
    const b = greatCircleDistanceProvider.distanceMeters(BENGALURU, MYSURU);
    expect(a).toBe(b);
  });

  it('returns meters: 1 degree of latitude ≈ 111.19 km', () => {
    const distance = greatCircleDistanceProvider.distanceMeters(
      point(0, 0),
      point(1, 0),
    );
    expect(distance).toBeGreaterThan(111_000);
    expect(distance).toBeLessThan(112_000);
  });

  it('measures a known pair: Bengaluru → Mysuru (roughly 130–145 km)', () => {
    const distance = greatCircleDistanceProvider.distanceMeters(
      BENGALURU,
      MYSURU,
    );
    expect(distance).toBeGreaterThan(125_000);
    expect(distance).toBeLessThan(150_000);
  });
});

describe('calculateDistanceMeters', () => {
  it('uses the great-circle provider by default', () => {
    expect(calculateDistanceMeters(BENGALURU, MYSURU)).toBe(
      greatCircleDistanceProvider.distanceMeters(BENGALURU, MYSURU),
    );
  });

  it('returns zero for identical points', () => {
    expect(calculateDistanceMeters(BENGALURU, BENGALURU)).toBe(0);
  });

  it('is deterministic and returns meter values', () => {
    const a = calculateDistanceMeters(BENGALURU, MYSURU);
    const b = calculateDistanceMeters(BENGALURU, MYSURU);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
  });

  it('honors an injected fake provider (the seam works)', () => {
    const fake: DistanceProvider = {
      id: 'fake',
      distanceMeters: (origin, destination) => {
        if (
          origin.latitude === destination.latitude &&
          origin.longitude === destination.longitude
        ) {
          return 0;
        }
        return 42;
      },
    };
    expect(calculateDistanceMeters(BENGALURU, MYSURU, fake)).toBe(42);
    expect(calculateDistanceMeters(BENGALURU, BENGALURU, fake)).toBe(0);
    // The default provider is untouched by the injection.
    expect(calculateDistanceMeters(BENGALURU, MYSURU)).not.toBe(42);
  });
});
