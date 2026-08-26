/**
 * Provider-independent routing port (Phase 3.12 — LOCATION & MAPS FOUNDATION,
 * §9, §20).
 *
 * The seam where a future routing provider (OD-007 — Google Maps, Mapbox,
 * HERE, OSRM, etc.) plugs in. OD-007 is OPEN: NO provider is selected, NO
 * provider SDK exists, NO network call is ever made here, and NO provider
 * credential or environment variable is introduced.
 *
 * The default behavior is provider-independent and fails closed: with no
 * provider configured, `calculateRoute` throws a provider-independent
 * `RoutingProviderError` — the system never silently falls back to a vendor
 * or invents a route. This mirrors the auth module's fail-closed posture
 * (`failClosedAuthenticator`, Phase 3.10).
 *
 * Failure semantics (§20): provider failures are represented by
 * `RoutingProviderError`, built on the existing `ExternalServiceError`
 * (502, not exposed to clients) — vendor-specific errors are wrapped at the
 * infrastructure boundary and never leak into the domain or API responses.
 */
import { ExternalServiceError } from '../../../lib/errors.js';
import type { RouteRequest, RouteResult } from '../domain/location.types.js';

/**
 * The routing seam. A future implementation provides route distance, route
 * duration, and optional route geometry for an origin/destination pair
 * WITHOUT coupling RidePool to its vendor. Implementations must never leak
 * vendor errors — they throw `RoutingProviderError` instead.
 */
export interface RoutingProvider {
  /** Machine-readable provider id, e.g. 'osrm' | 'google-maps' | 'mapbox'. */
  readonly id: string;
  /**
   * Calculates a route between `request.origin` and `request.destination`.
   * Resolves to a `RouteResult` with explicit units (distanceMeters,
   * durationSeconds) or throws `RoutingProviderError` (502) on any failure.
   */
  calculateRoute(request: RouteRequest): Promise<RouteResult>;
}

/**
 * Provider-independent routing failure (Phase 3.12 §20).
 *
 * Extends the existing `ExternalServiceError` (code EXTERNAL_SERVICE_ERROR,
 * HTTP 502, `expose: false`) — no new error framework. `providerId` records
 * which provider failed for diagnostics; the message stays vendor-neutral so
 * vendor details never reach API responses or logs unintentionally.
 */
export class RoutingProviderError extends ExternalServiceError {
  readonly providerId: string;

  constructor(
    message: string,
    options: { providerId?: string; cause?: unknown } = {},
  ) {
    super(message, {
      details: { providerId: options.providerId ?? 'unconfigured' },
      cause: options.cause,
    });
    this.name = 'RoutingProviderError';
    this.providerId = options.providerId ?? 'unconfigured';
  }
}

/**
 * The fail-closed default routing provider (OD-007 open). Every call throws a
 * provider-independent `RoutingProviderError` — no network requests, no
 * vendor, no invented route. A real implementation replaces this only when a
 * provider is actually selected.
 */
export const failClosedRoutingProvider: RoutingProvider = {
  id: 'fail-closed',
  async calculateRoute() {
    throw new RoutingProviderError(
      'No routing provider is configured (OD-007 is open); route calculation is unavailable',
    );
  },
};
