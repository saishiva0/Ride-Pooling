/**
 * API authentication header provider (Phase 3.14 — §11/§18; Phase 3.18 —
 * OD-005 resolved).
 *
 * The single explicit abstraction through which the API client receives
 * session credentials — no `Authorization` headers are ever scattered through
 * individual API calls, and no caller-supplied identity is ever accepted.
 *
 * Phase 3.18 adds `createStoredAuthHeadersProvider`, the concrete provider
 * backed by secure session storage: it returns
 * `Authorization: Bearer <stored token>` when a valid stored session exists
 * and null otherwise (fail closed). It also exposes the optional
 * `onAuthenticationFailure` hook the API client calls when a request comes
 * back with a 401 — the provider then clears the persisted session so the app
 * can settle into the unauthenticated boundary.
 */
import type { SessionStorage } from './storage/types';

export interface AuthHeadersProvider {
  /** Auth headers for the current session, or null when unauthenticated. */
  getAuthHeaders(): Promise<Record<string, string> | null>;
  /** Optional hook invoked when the API client observes a 401. */
  onAuthenticationFailure?: () => void;
}

/** The default fail-closed provider: no authentication is available. */
export const noAuthHeadersProvider: AuthHeadersProvider = {
  async getAuthHeaders() {
    return null;
  },
};

/** Bearer-token provider over persisted secure storage (fail closed). */
export function createStoredAuthHeadersProvider(
  storage: SessionStorage,
): AuthHeadersProvider {
  return {
    async getAuthHeaders() {
      let stored: { token: string; expiresAt: string } | null = null;
      try {
        stored = await storage.get();
      } catch {
        stored = null;
      }
      if (stored === null) {
        return null;
      }
      if (Number.isNaN(Date.parse(stored.expiresAt))) {
        await storage.clear().catch(() => undefined);
        return null;
      }
      if (Date.now() >= Date.parse(stored.expiresAt)) {
        await storage.clear().catch(() => undefined);
        return null;
      }
      return { Authorization: `Bearer ${stored.token}` };
    },
    onAuthenticationFailure() {
      // The token is no longer accepted: drop it so the next request goes out
      // unauthenticated and the app can settle to the auth boundary.
      void storage.clear().catch(() => undefined);
    },
  };
}
