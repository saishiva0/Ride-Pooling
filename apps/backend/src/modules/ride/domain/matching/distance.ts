/**
 * Straight-line great-circle distance (Phase 3.4 — destination
 * compatibility).
 *
 * Pure and deterministic — no network, no provider. `docs/domain/matching-model.md`
 * §7 names the "straight-line fallback vs. actual routes" as the distance
 * approach with the decision deferred (OD-007). This module implements the
 * documented straight-line fallback only; it isolates the distance
 * computation in a single pure function so the actual-route variant can be
 * swapped in behind the same interface when OD-007 is decided. It is used
 * exclusively for destination compatibility — pickup distance is reused from
 * discovery, never recomputed here.
 */
import type { RideCoordinates } from '../ride.types.js';

/** Mean Earth radius in meters (WGS84 mean radius approximation). */
const EARTH_RADIUS_METERS = 6_371_000;

const DEG_TO_RAD = Math.PI / 180;

/**
 * Great-circle distance between two WGS84 coordinate pairs, in meters
 * (haversine formula).
 *
 * Deterministic and symmetric: `distance(a, b) === distance(b, a)` and
 * `distance(p, p) === 0`. Results are Float64 numbers; for the tolerances
 * used by matching (hundreds of meters to kilometres) the error is well
 * under a metre for typical city distances.
 */
export function greatCircleDistanceMeters(
  a: RideCoordinates,
  b: RideCoordinates,
): number {
  const lat1 = a.latitude * DEG_TO_RAD;
  const lat2 = b.latitude * DEG_TO_RAD;
  const deltaLat = (b.latitude - a.latitude) * DEG_TO_RAD;
  const deltaLon = (b.longitude - a.longitude) * DEG_TO_RAD;

  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}
