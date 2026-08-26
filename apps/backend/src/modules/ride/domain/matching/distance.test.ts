/**
 * Unit tests for the pure great-circle distance used by destination
 * compatibility (Phase 3.4).
 *
 * No database, no network — pure function tests. Uses well-known reference
 * distances (1° of latitude ≈ 111.19 km on the WGS84 mean-radius sphere).
 */
import { describe, expect, it } from 'vitest';
import { greatCircleDistanceMeters } from './distance.js';
import type { RideCoordinates } from '../ride.types.js';

function point(latitude: number, longitude: number): RideCoordinates {
  return { latitude, longitude };
}

describe('greatCircleDistanceMeters', () => {
  it('returns 0 for the same point', () => {
    const p = point(12.9716, 77.5946);
    expect(greatCircleDistanceMeters(p, p)).toBe(0);
  });

  it('is symmetric', () => {
    const a = point(12.9716, 77.5946);
    const b = point(12.2958, 76.6394);
    expect(greatCircleDistanceMeters(a, b)).toBe(
      greatCircleDistanceMeters(b, a),
    );
  });

  it('matches the reference distance for 1 degree of latitude (~111.19 km)', () => {
    const distance = greatCircleDistanceMeters(point(0, 0), point(1, 0));
    expect(distance).toBeGreaterThan(111_000);
    expect(distance).toBeLessThan(112_000);
  });

  it('matches the reference distance for 1 degree of longitude at the equator (~111.19 km)', () => {
    const distance = greatCircleDistanceMeters(point(0, 0), point(0, 1));
    expect(distance).toBeGreaterThan(111_000);
    expect(distance).toBeLessThan(112_000);
  });

  it('measures Bengaluru → Mysuru (roughly 130-145 km)', () => {
    const distance = greatCircleDistanceMeters(
      point(12.9716, 77.5946),
      point(12.2958, 76.6394),
    );
    expect(distance).toBeGreaterThan(125_000);
    expect(distance).toBeLessThan(150_000);
  });

  it('scales with distance (5 km north is less than 50 km north)', () => {
    const fiveKm = greatCircleDistanceMeters(
      point(12.9716, 77.5946),
      point(13.0167, 77.5946),
    );
    const fiftyKm = greatCircleDistanceMeters(
      point(12.9716, 77.5946),
      point(13.4217, 77.5946),
    );
    expect(fiveKm).toBeGreaterThan(4_900);
    expect(fiveKm).toBeLessThan(5_100);
    expect(fiftyKm).toBeGreaterThan(49_000);
    expect(fiftyKm).toBeLessThan(51_000);
    expect(fiveKm).toBeLessThan(fiftyKm);
  });
});
