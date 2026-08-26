/**
 * Centralized mobile configuration (Phase 3.13 — MOBILE FOUNDATION).
 *
 * All environment-driven values live here — never scattered through
 * components (Phase 3.13 principle L). Only `EXPO_PUBLIC_*` variables are
 * inlined into the app bundle by Expo; nothing secret belongs here. The
 * environment name parser is reused from `@ridepool/config` (shared
 * configuration utility) instead of being reimplemented.
 *
 * Platform notes (see `.env.example`):
 * - Web / iOS simulator: `http://localhost:4000`
 * - Android emulator:    `http://10.0.2.2:4000`
 * - Physical device:     `http://<your-machine-LAN-IP>:4000`
 */
import { parseNodeEnv, type NodeEnv } from '@ridepool/config';

export const DEFAULT_API_BASE_URL = 'http://localhost:4000';

/** Reserved for a future realtime transport; null = realtime disabled. */
export const DEFAULT_REALTIME_URL: string | null = null;

export interface MobileConfig {
  /** Environment name ('development' | 'test' | 'production'). */
  env: NodeEnv;
  /** Backend API base URL (no trailing slash). */
  apiBaseUrl: string;
  /**
   * Realtime endpoint, or null when realtime is disabled. Realtime stays
   * disabled until delivery details (OD-008) are resolved — the mobile
   * realtime boundary is provider-neutral (see `src/realtime/`).
   */
  realtimeUrl: string | null;
  /**
   * Google Maps Platform API key for device location, geocoding, and routing
   * (Phase 3.20, OD-007). Null when unconfigured — the location/map wiring
   * FAILS CLOSED (OD-007 resolution keeps the app fully functional with no
   * map provider; every map/geocoding/route call surfaces a normalized
   * `MobileError` instead of a fabricated coordinate or route).
   *
   * The key is `EXPO_PUBLIC_*` only because it ships inside the app bundle
   * (an Android/iOS-restricted public key). It is NOT a server-side secret.
   */
  googleMapsApiKey: string | null;
}

/**
 * Resolves the API base URL from `EXPO_PUBLIC_API_URL`, falling back to the
 * local development default. Trailing slashes are stripped so URL building is
 * deterministic.
 */
export function resolveApiBaseUrl(envApiUrl: string | undefined): string {
  const candidate = envApiUrl?.trim();
  if (!candidate) {
    return DEFAULT_API_BASE_URL;
  }
  return candidate.replace(/\/+$/, '');
}

/** The non-versioned health endpoint (outside /api/v1 per Phase 0). */
export function buildHealthUrl(baseUrl: string): string {
  return `${resolveApiBaseUrl(baseUrl)}/health`;
}

/** Resolves the Google Maps API key (trimmed), or null when unset/blank. */
export function resolveGoogleMapsApiKey(
  envApiKey: string | undefined,
): string | null {
  const candidate = envApiKey?.trim();
  return candidate ? candidate : null;
}

/** Resolves the realtime URL from `EXPO_PUBLIC_REALTIME_URL`.
 * Returns null when realtime is disabled (unset or explicit null). */
export function resolveRealtimeUrl(
  envRealtimeUrl: string | undefined,
): string | null {
  const candidate = envRealtimeUrl?.trim();
  if (!candidate || candidate.toLowerCase() === 'null') {
    return null;
  }
  return candidate.replace(/\/+$/, '');
}

/**
 * Loads the mobile configuration from the environment. Safe to call with an
 * explicit record in tests (no reliance on `process.env` being present).
 * No secrets are read or exposed here.
 */
export function loadMobileConfig(
  env: Record<string, string | undefined> = process.env,
): MobileConfig {
  const _apiBaseUrl = resolveApiBaseUrl(env.EXPO_PUBLIC_API_URL);
  return {
    env: parseNodeEnv(env.NODE_ENV),
    apiBaseUrl: _apiBaseUrl,
    realtimeUrl: resolveRealtimeUrl(env.EXPO_PUBLIC_REALTIME_URL),
    googleMapsApiKey: resolveGoogleMapsApiKey(
      env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
    ),
  };
}
