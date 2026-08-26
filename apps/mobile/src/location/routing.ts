/**
 * Provider-independent routing port (Phase 3.20 — GOOGLE MAPS & LOCATION
 * INTEGRATION; mirrors the Phase 3.12 backend port in
 * `apps/backend/src/modules/location/application/routing.ts`).
 *
 * The seam where a routing provider (OD-007 — Google Routes, Mapbox, OSRM,
 * etc.) plugs in. Screens and hooks depend ONLY on this interface — never on
 * a routing SDK or HTTP client directly.
 *
 * The default behavior fails closed: with no provider configured,
 * `calculateRoute` throws a normalized `MobileError` (`external-service`) —
 * the system never silently falls back to a vendor or invents a route.
 */
import { MobileError } from '../api/errors';
import type { RouteRequest, RouteResult } from './location.types';

/**
 * The routing seam. A future implementation provides route distance, route
 * duration, and optional route geometry for an origin/destination pair WITHOUT
 * coupling RidePool to its vendor. Implementations must never leak vendor
 * errors — they throw normalized `MobileError`s instead.
 */
export interface RoutingProvider {
  /** Machine-readable provider id, e.g. 'google-maps' | 'mapbox'. */
  readonly id: string;
  /**
   * Calculates a route between `request.origin` and `request.destination`.
   * Resolves to a `RouteResult` with explicit units (distanceMeters,
   * durationSeconds) or throws a normalized `MobileError` on any failure.
   */
  calculateRoute(request: RouteRequest): Promise<RouteResult>;
}

/**
 * The fail-closed default routing provider. Every call throws — no network
 * requests, no vendor, no invented route. A real implementation replaces this
 * only when a provider is actually configured.
 */
export const failClosedRoutingProvider: RoutingProvider = {
  id: 'fail-closed',
  async calculateRoute() {
    throw new MobileError(
      'external-service',
      'Route calculation is unavailable (no Maps provider is configured)',
      { details: { provider: 'fail-closed', reason: 'unconfigured' } },
    );
  },
};
