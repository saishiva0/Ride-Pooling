/**
 * Mobile coordinate validation (Phase 3.16 — MOBILE LOCATION, GPS & MAPS
 * FOUNDATION).
 *
 * The mobile mirror of the authoritative Phase 3.12 WGS84 rules
 * (`apps/backend/src/modules/location/domain/coordinate.ts`): latitude ∈
 * [-90, 90], longitude ∈ [-180, 180], finite numbers only (NaN and ±Infinity
 * rejected). The bounds constants live here exactly once on mobile and are
 * reused by the ride discovery form parser (`ride/validation.ts`) — no
 * duplicated validation formulas inside the app.
 *
 * Error model: assertions throw the existing normalized `MobileError` with
 * kind `validation` (never raw native/provider detail). The rules are pure
 * and deterministic; valid coordinates are passed through unchanged (no
 * rounding, truncation, or precision policy — none invented).
 */
import { MobileError } from '../api/errors';
import type {
  Coordinate,
  GeoJsonPoint,
  LocationReference,
} from './location.types';

export const LATITUDE_MIN = -90;
export const LATITUDE_MAX = 90;
export const LONGITUDE_MIN = -180;
export const LONGITUDE_MAX = 180;

/** Latitude must be a finite number within WGS84 bounds ([-90, 90]). */
export function isValidLatitude(latitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    latitude >= LATITUDE_MIN &&
    latitude <= LATITUDE_MAX
  );
}

/** Longitude must be a finite number within WGS84 bounds ([-180, 180]). */
export function isValidLongitude(longitude: number): boolean {
  return (
    Number.isFinite(longitude) &&
    longitude >= LONGITUDE_MIN &&
    longitude <= LONGITUDE_MAX
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
 * Throws a normalized `MobileError` (`validation`) when the coordinate is not
 * a valid WGS84 point. `field` prefixes the failing component path (e.g.
 * `'pickup'` → `pickup.latitude` / `pickup.longitude`), mirroring the Phase
 * 3.12 `assertValidCoordinate`.
 */
export function assertValidCoordinate(
  coordinate: Coordinate,
  field = 'coordinate',
): void {
  if (!isValidLatitude(coordinate.latitude)) {
    throw new MobileError(
      'validation',
      `latitude must be a finite number between ${LATITUDE_MIN} and ${LATITUDE_MAX}`,
      {
        field: `${field}.latitude`,
        details: { latitude: coordinate.latitude },
      },
    );
  }
  if (!isValidLongitude(coordinate.longitude)) {
    throw new MobileError(
      'validation',
      `longitude must be a finite number between ${LONGITUDE_MIN} and ${LONGITUDE_MAX}`,
      {
        field: `${field}.longitude`,
        details: { longitude: coordinate.longitude },
      },
    );
  }
}

/**
 * The coordinate normalization entry point (Phase 3.12 §17): validates a
 * numeric coordinate pair and returns the canonical `Coordinate` unchanged.
 * Valid values are never silently modified. Throws a normalized
 * `MobileError` on invalid input.
 */
export function asCoordinate(coordinate: Coordinate): Coordinate {
  assertValidCoordinate(coordinate);
  return { latitude: coordinate.latitude, longitude: coordinate.longitude };
}

/**
 * Pure GeoJSON Point serialization (Phase 3.12 §18) for future map clients,
 * with coordinate order **[longitude, latitude]** — the project's
 * serialization convention (identical to PostGIS `ST_MakePoint(longitude,
 * latitude)`). This is the mobile serialization boundary; the coordinate-order
 * regression is pinned in `coordinate.test.ts`. GeoJSON is never persisted.
 */
export function toGeoJsonPoint(coordinate: Coordinate): GeoJsonPoint {
  assertValidCoordinate(coordinate);
  return {
    type: 'Point',
    coordinates: [coordinate.longitude, coordinate.latitude],
  };
}

/** Converts any structurally-compatible location to the `LocationReference`
 * contract (existing ride locations are supersets and assignable directly). */
export function asLocationReference(location: {
  latitude: number;
  longitude: number;
  label?: string | null;
}): LocationReference {
  assertValidCoordinate(location);
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    ...(location.label !== null && location.label !== undefined
      ? { label: location.label }
      : {}),
  };
}

/** Human-readable rendering of a location reference (label, else "lat, lng"). */
export function formatLocationReference(reference: LocationReference): string {
  return reference.label ?? `${reference.latitude}, ${reference.longitude}`;
}
