/**
 * Mobile location & maps types (Phase 3.16 — MOBILE LOCATION, GPS & MAPS
 * FOUNDATION).
 *
 * Provider-independent, platform-independent contracts mirroring the Phase
 * 3.12 backend foundation (`apps/backend/src/modules/location/domain/
 * location.types.ts`). They are the seam where a future device-location
 * adapter (e.g. `expo-location`) and a future map provider (OD-007) plug in —
 * screens never touch Expo Location, native location APIs, browser
 * geolocation, or map SDKs directly.
 *
 * WHY THESE LOCAL TYPES EXIST: `@ridepool/shared` ships no location contracts,
 * and the authoritative backend coordinate module (`modules/location/domain/
 * coordinate.ts`) imports backend-only code (`lib/errors.js`), so it cannot be
 * imported by mobile. These types are structurally compatible with the Phase
 * 3.12 contracts (identical field names/semantics — no competing coordinate
 * model is introduced) and are documented here so that when a shared location
 * package exists it becomes the single source. No Prisma types, no backend
 * modules, and no provider SDKs are imported.
 */

/** A geographic coordinate pair on the WGS84 ellipsoid (decimal degrees).
 * Structurally identical to the Phase 3.12 `Coordinate`. Bounds: latitude ∈
 * [-90, 90], longitude ∈ [-180, 180] (see `coordinate.ts`). */
export interface Coordinate {
  latitude: number;
  longitude: number;
}

/**
 * The map-ready, client-facing location contract (Phase 3.12 §12): latitude,
 * longitude, and an optional human-readable label. Existing ride API locations
 * (`{ id, latitude, longitude, label }`) are a superset of this contract, so
 * they are structurally assignable to it.
 */
export interface LocationReference {
  latitude: number;
  longitude: number;
  label?: string;
}

/**
 * A GeoJSON Point (RFC 7946) with the project's serialization convention:
 * coordinate order **[longitude, latitude]** (identical to the PostGIS
 * `ST_MakePoint(longitude, latitude)` convention and the Phase 3.12
 * `toGeoJsonPoint`). Produced only at serialization boundaries; never
 * persisted and never reversed.
 */
export interface GeoJsonPoint {
  type: 'Point';
  coordinates: [number, number];
}

/**
 * Input to a routing provider (Phase 3.20; mirrors the Phase 3.12 `RouteRequest`):
 * an origin and a destination. Kept as a single object so the contract can grow
 * (waypoints, departure time, transport mode) without breaking implementations.
 */
export interface RouteRequest {
  origin: Coordinate;
  destination: Coordinate;
}

/**
 * A GeoJSON LineString geometry (RFC 7946). Coordinate order:
 * [longitude, latitude] — identical to the Phase 3.12 `LineStringGeometry`.
 */
export interface LineStringGeometry {
  type: 'LineString';
  coordinates: Array<[number, number]>;
}

/**
 * A routing provider's route answer (Phase 3.20; mirrors the Phase 3.12
 * `RouteResult`). Units are explicit by name — distance in meters, duration in
 * seconds. Geometry is optional (some providers cost per geometry payload).
 *
 * Note: the straight-line great-circle distance remains the authoritative V1
 * matching approach (OD-004/OD-007); this is the contract a routing provider
 * returns, not a replacement for it.
 */
export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry?: LineStringGeometry;
}
