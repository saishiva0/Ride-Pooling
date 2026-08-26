/**
 * Provider-independent coordinate validation, normalization, and serialization
 * (Phase 3.12 — LOCATION & MAPS FOUNDATION).
 *
 * This is the centralized home of the WGS84 coordinate bounds and predicates.
 * The Phase 3.1 ride rules (`modules/ride/domain/ride-rules.ts`) RE-EXPORT
 * `isValidLatitude`/`isValidLongitude` from here so the Ride Engine's public
 * surface is unchanged while validation lives in exactly one place — the
 * success criteria require coordinate validation to remain centralized, and
 * the phase requires the coordinate abstraction to depend on no framework
 * (Prisma/Express/React Native/Socket.io/map provider). This module is pure:
 * no I/O, no persistence, no network, no framework imports.
 *
 * Coordinate semantics (unchanged from Phase 3.1, `docs/domain/domain-model.md`
 * §5.2): WGS84 decimal degrees; latitude ∈ [-90, 90]; longitude ∈ [-180, 180].
 * Valid values are passed through UNCHANGED — nothing here rounds, truncates,
 * or otherwise silently modifies a valid coordinate (no precision policy is
 * invented; see Phase 3.12 notes §7). NaN/±Infinity are rejected.
 */
import { ValidationError } from '../../../lib/errors.js';
import type { Coordinate, GeoJsonPoint } from './location.types.js';

const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

/**
 * Latitude must be a finite number within WGS84 bounds ([-90, 90]).
 * Authoritative predicate — re-exported by the Ride Engine's `ride-rules.ts`.
 */
export function isValidLatitude(latitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    latitude >= MIN_LATITUDE &&
    latitude <= MAX_LATITUDE
  );
}

/**
 * Longitude must be a finite number within WGS84 bounds ([-180, 180]).
 * Authoritative predicate — re-exported by the Ride Engine's `ride-rules.ts`.
 */
export function isValidLongitude(longitude: number): boolean {
  return (
    Number.isFinite(longitude) &&
    longitude >= MIN_LONGITUDE &&
    longitude <= MAX_LONGITUDE
  );
}

/** Both components of a coordinate pair must be valid. */
export function isValidCoordinate(coordinate: Coordinate): boolean {
  return (
    isValidLatitude(coordinate.latitude) &&
    isValidLongitude(coordinate.longitude)
  );
}

/**
 * Throws `ValidationError` (400) when the coordinate is not a valid WGS84
 * point. `field` prefixes the failing component path (e.g. `'pickup'` →
 * `pickup.latitude` / `pickup.longitude`). Used at application boundaries;
 * the pure predicates above remain available for callers that need a boolean.
 */
export function assertValidCoordinate(
  coordinate: Coordinate,
  field = 'coordinate',
): void {
  if (!isValidLatitude(coordinate.latitude)) {
    throw new ValidationError(
      'latitude must be a finite number between -90 and 90',
      {
        field: `${field}.latitude`,
        details: { latitude: coordinate.latitude },
      },
    );
  }
  if (!isValidLongitude(coordinate.longitude)) {
    throw new ValidationError(
      'longitude must be a finite number between -180 and 180',
      {
        field: `${field}.longitude`,
        details: { longitude: coordinate.longitude },
      },
    );
  }
}

/**
 * The coordinate normalization entry point (Phase 3.12 §17).
 *
 * Validates a numeric coordinate pair (rejecting NaN/±Infinity and
 * out-of-range values) and returns the canonical `Coordinate` unchanged.
 * Valid values are never silently modified: no rounding, no truncation, no
 * precision policy. Throws `ValidationError` on invalid input.
 */
export function asCoordinate(coordinate: Coordinate): Coordinate {
  assertValidCoordinate(coordinate);
  return { latitude: coordinate.latitude, longitude: coordinate.longitude };
}

/**
 * Pure GeoJSON Point serialization for future map clients (Phase 3.12 §18).
 *
 * Produces a valid RFC 7946 GeoJSON Point with coordinate order
 * **[longitude, latitude]** — identical to the PostGIS generated column
 * convention (`ST_MakePoint(longitude, latitude)` in the Phase 2 migration).
 * This is a serialization boundary separate from the database representation:
 * GeoJSON is NEVER persisted (the `Location` lat/lng columns + generated
 * PostGIS point remain authoritative). Deterministic: same input always
 * yields the same output. Invalid input throws `ValidationError`.
 */
export function toGeoJsonPoint(coordinate: Coordinate): GeoJsonPoint {
  assertValidCoordinate(coordinate);
  return {
    type: 'Point',
    coordinates: [coordinate.longitude, coordinate.latitude],
  };
}
