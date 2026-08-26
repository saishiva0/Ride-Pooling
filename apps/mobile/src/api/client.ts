/**
 * Centralized mobile API client (Phase 3.13 — MOBILE FOUNDATION, §11).
 *
 * The only place mobile code talks to the backend over HTTP. It understands
 * the two shared contracts from `@ridepool/shared`:
 *
 *   success: { data: ... }      (ApiDataResponse)
 *   error:   { error: { code, message, field?, details? } }   (ApiErrorResponse)
 *
 * All business routes live under the versioned namespace (`API_BASE_PATH` =
 * /api/v1, from `@ridepool/shared`); the health endpoint is outside it and is
 * reached via `buildHealthUrl` in `src/config/env.ts` when needed.
 *
 * The client is generic (one `request<T>` function) — no ride-specific
 * functions are needed yet, and no backend business validation is duplicated.
 * Every failure is normalized to a `MobileError` (see `errors.ts`): raw
 * fetch errors and raw response payloads never escape this module.
 *
 * A 2xx response with no body (e.g. a 204 from `DELETE`, used by Phase
 * 3.24's unblock endpoint) has no `{ data: ... }` envelope to unwrap and
 * resolves to `undefined` — this is distinct from a malformed 2xx JSON body
 * (present but missing `data`), which still fails closed as `MobileError`.
 *
 * Phase 3.14: the client receives session credentials through an explicit
 * `authProvider` seam (see `src/auth/auth-headers.ts`). Auth-provided headers
 * always win over caller headers so identity can never be caller-controlled;
 * if the provider fails, the request fails closed and is never sent.
 */
import {
  API_BASE_PATH,
  type ApiDataResponse,
  type ApiErrorResponse,
} from '@ridepool/shared';
import { normalizeAuthError } from '../auth/errors';
import type { AuthHeadersProvider } from '../auth/auth-headers';
import { MobileError, apiErrorFromBody, toMobileError } from './errors';

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface ApiClientConfig {
  /** Backend API base URL (no trailing slash). */
  baseUrl: string;
  /** Request timeout in milliseconds (defaults to `DEFAULT_TIMEOUT_MS`). */
  timeoutMs?: number;
  /** Default headers applied to every request (per-request headers win). */
  headers?: Record<string, string>;
  /**
   * Supplies per-request authentication headers (e.g. Authorization) from the
   * current session. Fail-closed default: absent (no auth headers attached).
   * Auth-provided headers are merged LAST so callers cannot override identity;
   * if the provider throws, the request fails closed and is not sent.
   */
  authProvider?: AuthHeadersProvider;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON-serializable body; omitted for GET requests. */
  body?: unknown;
  /** Per-request headers (merged over the client's default headers). */
  headers?: Record<string, string>;
  /** Per-request timeout override (milliseconds). */
  timeoutMs?: number;
}

export interface ApiClient {
  /**
   * Performs a request to a business endpoint and returns the unwrapped
   * `data` payload. `path` is relative to the versioned namespace, e.g.
   * `/rides/discover`. Throws `MobileError` on any failure.
   */
  request<T>(path: string, options?: ApiRequestOptions): Promise<T>;
}

/** Builds the absolute URL for a business path under /api/v1. */
export function buildApiUrl(baseUrl: string, path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${API_BASE_PATH}${cleanPath}`;
}

/** Parses a non-2xx JSON body into a `MobileError` (never raw). */
function errorFromResponse(parsed: unknown, status: number): MobileError {
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'error' in parsed &&
    typeof (parsed as ApiErrorResponse).error === 'object' &&
    (parsed as ApiErrorResponse).error !== null
  ) {
    return apiErrorFromBody((parsed as ApiErrorResponse).error, status);
  }
  return new MobileError('unknown', `Request failed with status ${status}`, {
    statusCode: status,
  });
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async request<T>(
      path: string,
      options: ApiRequestOptions = {},
    ): Promise<T> {
      const url = buildApiUrl(config.baseUrl, path);
      const requestTimeout = options.timeoutMs ?? timeoutMs;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeout);

      try {
        let authHeaders: Record<string, string> | undefined;
        if (config.authProvider !== undefined) {
          try {
            authHeaders =
              (await config.authProvider.getAuthHeaders()) ?? undefined;
          } catch (err) {
            // Authentication infrastructure failure: fail closed, never send.
            throw normalizeAuthError(err);
          }
        }

        const response = await fetch(url, {
          method: options.method ?? 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...config.headers,
            ...options.headers,
            ...authHeaders,
          },
          body:
            options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
          signal: controller.signal,
        });

        const text = await response.text();
        let parsed: unknown = null;
        if (text.length > 0) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
        }

        if (!response.ok) {
          const error = errorFromResponse(parsed, response.status);
          // A rejected session must never keep being reused: notify the auth
          // provider so it clears the persisted session and the app can
          // settle into the unauthenticated boundary (Phase 3.18).
          if (error.kind === 'authentication' || error.statusCode === 401) {
            config.authProvider?.onAuthenticationFailure?.();
          }
          throw error;
        }

        // No-content success (e.g. 204 from a DELETE): there is no envelope
        // to unwrap. Distinct from a malformed 2xx JSON body (see below).
        if (response.status === 204 || text.length === 0) {
          return undefined as T;
        }

        // Success envelope: every /api/v1 success is { data: ... }.
        if (
          parsed === null ||
          typeof parsed !== 'object' ||
          !('data' in parsed)
        ) {
          throw new MobileError(
            'unknown',
            'Malformed success response: missing "data" envelope',
            { statusCode: response.status },
          );
        }
        return (parsed as ApiDataResponse<T>).data;
      } catch (err) {
        if (err instanceof MobileError) {
          throw err;
        }
        if (controller.signal.aborted) {
          throw new MobileError(
            'timeout',
            `Request timed out after ${requestTimeout}ms`,
          );
        }
        throw toMobileError(err);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
