/**
 * Provider-independent distance service (Phase 3.12 — LOCATION & MAPS
 * FOUNDATION, §7–§8).
 *
 * Distance semantics: the system uses STRAIGHT-LINE great-circle distance
 * (WGS84) for pickup proximity, destination compatibility, and discovery
 * distance — `docs/domain/matching-model.md` §7 names this as the documented
 * V1 approach with the actual-route alternative deferred to OD-007. The
 * authoritative implementation is the Phase 3.4 haversine
 * `greatCircleDistanceMeters` (`modules/ride/domain/matching/distance.ts`);
 * this module REUSES it — there is deliberately no second Haversine.
 *
 * The `DistanceProvider` port is the seam where a future routing-based
 * distance (OD-007) could plug in without changing callers. The default
 * provider is the great-circle fallback, so the module is fully usable today
 * with no provider and no network calls.
 *
 * Units: meters everywhere. Every public result makes its unit explicit
 * through naming (`distanceMeters`) — no ambiguous `distance` numbers.
 */
import { greatCircleDistanceMeters } from '../../ride/domain/matching/distance.js';
import type { Coordinate } from '../domain/location.types.js';

/**
 * The distance seam. A future implementation (e.g. a routing provider once
 * OD-007 is decided) implements this interface; callers depend only on it.
 * The method name carries the unit: meters.
 */
export interface DistanceProvider {
  /** Machine-readable provider id, e.g. 'great-circle' | 'routing:<vendor>'. */
  readonly id: string;
  /** Straight-line distance between two coordinates, in meters. */
  distanceMeters(origin: Coordinate, destination: Coordinate): number;
}

/**
 * The default distance provider: the authoritative Phase 3.4 great-circle
 * implementation (haversine), reused — not reimplemented. Pure, deterministic,
 * symmetric, and offline.
 */
export const greatCircleDistanceProvider: DistanceProvider = {
  id: 'great-circle',
  distanceMeters: (origin, destination) =>
    greatCircleDistanceMeters(origin, destination),
};

/**
 * Calculates the straight-line distance between two WGS84 coordinates in
 * meters, using the great-circle provider by default. The provider is
 * injectable so callers can swap in a future routing-based implementation
 * without changing their code.
 *
 * Semantics are identical to the Phase 3.4 function: deterministic and
 * symmetric, `distanceMeters(p, p) === 0`, results in meters.
 */
export function calculateDistanceMeters(
  origin: Coordinate,
  destination: Coordinate,
  provider: DistanceProvider = greatCircleDistanceProvider,
): number {
  return provider.distanceMeters(origin, destination);
}
