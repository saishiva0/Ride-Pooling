/**
 * Provider-independent location & maps domain types (Phase 3.12 — LOCATION &
 * MAPS FOUNDATION).
 *
 * This module is the seam where the future map/routing/geocoding provider
 * (OD-007) plugs in. It deliberately depends on NO vendor, NO provider SDK,
 * NO Prisma, NO Express, NO React Native, and NO Socket.io — every type here
 * is pure and framework-free so the rest of the system can consume the
 * location/maps foundation without coupling to a provider.
 *
 * The authoritative product spec is `docs/domain/domain-model.md` §5 (Location
 * model) and `docs/domain/matching-model.md` §7 (distance approach; OD-007).
 * No open decision is resolved here: OD-007 (map/routing/geocoding provider)
 * stays OPEN — these are contracts, not implementations.
 */

/**
 * A geographic coordinate pair on the WGS84 ellipsoid (decimal degrees).
 *
 * The canonical conceptual shape for this phase: latitude + longitude.
 * Structurally identical to the Phase 3.1 `RideCoordinates`
 * (`modules/ride/domain/ride.types.ts`), which remains authoritative inside
 * the Ride Engine; the two types are mutually assignable and need no
 * conversion. Bounds are WGS84: latitude ∈ [-90, 90], longitude ∈ [-180, 180]
 * (validated by `modules/location/domain/coordinate.ts`).
 */
export interface Coordinate {
  latitude: number;
  longitude: number;
}

/**
 * The map-ready, client-facing location contract (Phase 3.12 §12).
 *
 * Exposes only what a map client actually needs — latitude, longitude, and an
 * optional human-readable label. No database identifiers, no PostGIS/geometry
 * details, no provider fields, no address/place ids (those are future
 * metadata, NOT persisted anywhere in the approved schema).
 *
 * Existing ride API responses already satisfy this contract: `CreatedRide.pickupLocation`
 * / `DiscoveredRide.pickupLocation` are `{ id, latitude, longitude, label }`,
 * a superset of `LocationReference` (the extra `id` is harmless for map
 * rendering and useful as a list key).
 */
export interface LocationReference {
  latitude: number;
  longitude: number;
  label?: string;
}

/**
 * Input to a routing provider: an origin and a destination. Kept as a single
 * object so the contract can grow (waypoints, departure time, transport mode)
 * without breaking implementations when a provider is selected (OD-007).
 */
export interface RouteRequest {
  origin: Coordinate;
  destination: Coordinate;
}

/** A GeoJSON LineString geometry (RFC 7946). Coordinate order: [longitude, latitude]. */
export interface LineStringGeometry {
  type: 'LineString';
  coordinates: Array<[number, number]>;
}

/**
 * A routing provider's route answer. Units are explicit by name — distance in
 * meters, duration in seconds. Geometry is optional (some providers cost per
 * geometry payload; the future consumer decides).
 *
 * Note: the straight-line great-circle distance (`application/distance.ts`) is
 * the authoritative V1 approach for matching (OD-004/OD-007); this is the
 * contract a future routing provider returns, not a replacement for it.
 */
export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry?: LineStringGeometry;
}

/**
 * A GeoJSON Point (RFC 7946). Coordinate order: [longitude, latitude] — the
 * same order the PostGIS generated column uses (`ST_MakePoint(longitude,
 * latitude)`). Produced by the pure serializer in `coordinate.ts` for future
 * map clients; it is NEVER persisted (the database keeps latitude/longitude
 * columns + the generated PostGIS point as authoritative).
 */
export interface GeoJsonPoint {
  type: 'Point';
  coordinates: [number, number];
}
