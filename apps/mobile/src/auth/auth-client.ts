/**
 * AuthClient (Phase 3.13 — MOBILE FOUNDATION, §10; Phase 3.18 — OD-005
 * resolved: phone + OTP).
 *
 * The provider-independent client port consumed by `AuthProvider`. Phase 3.18
 * adds the concrete `createAuthClient` implementation backed by the auth API
 * and secure storage:
 *
 *   - `getSession()` restores the persisted session and RE-VALIDATES it with
 *     the backend (`GET /auth/me`) so a stale, expired, or revoked session is
 *     never trusted. Storage failures and any "no session" outcome fail
 *     closed to `null`; network/server failures propagate so the provider can
 *     fail closed into the authentication-error state.
 *   - `requestOtp(phone)` requests a fresh OTP (generic success).
 *   - `signIn(phone, otp)` verifies the OTP, persists the returned session,
 *     and returns it. The raw token is persisted ONLY in secure storage and
 *     never surfaces to UI state.
 *   - `signOut()` best-effort revokes the session server-side and always
 *     clears local storage.
 *
 * The fail-closed default (`unavailableAuthClient`) remains so an app
 * constructed without a real client can never authenticate.
 */
import { createAuthSession, type AuthSession } from './types';
import type { AuthApi } from './auth-api';
import type { SessionStorage, StoredSession } from './storage/types';
import { MobileError } from '../api/errors';

/** AuthClient port consumed by AuthProvider and screens. */
export interface AuthClient {
  /** Restores + validates the current session, or null when unauthenticated. */
  getSession(): Promise<AuthSession | null>;
  /** Requests a fresh OTP for `phone` (generic success; throws on failure). */
  requestOtp(phone: string): Promise<void>;
  /** Verifies `phone` + `otp` and returns the authenticated session. */
  signIn(phone: string, otp: string): Promise<AuthSession>;
  /** Best-effort server revoke + local clear. */
  signOut(): Promise<void>;
}

/** Thrown by the fail-closed client when authentication is not configured. */
export class AuthenticationUnavailableError extends Error {
  constructor(message = 'Authentication is not configured') {
    super(message);
    this.name = 'AuthenticationUnavailableError';
  }
}

/** The default fail-closed client (OD-005 resolved, but never assumed). */
export const unavailableAuthClient: AuthClient = {
  async getSession() {
    return null;
  },
  async requestOtp() {
    throw new AuthenticationUnavailableError();
  },
  async signIn() {
    throw new AuthenticationUnavailableError();
  },
  async signOut() {
    // Safe no-op: nothing to clear.
  },
};

export interface AuthClientDependencies {
  api: AuthApi;
  storage: SessionStorage;
}

/** Builds the concrete AuthClient over the auth API + secure storage. */
export function createAuthClient(deps: AuthClientDependencies): AuthClient {
  return {
    async getSession() {
      let stored: StoredSession | null = null;
      try {
        stored = await deps.storage.get();
      } catch {
        // Storage read failure → no session (fail closed, never crash).
        return null;
      }
      if (stored === null) {
        return null;
      }
      if (Number.isNaN(Date.parse(stored.expiresAt))) {
        await deps.storage.clear().catch(() => undefined);
        return null;
      }
      if (Date.now() >= Date.parse(stored.expiresAt)) {
        await deps.storage.clear().catch(() => undefined);
        return null;
      }

      try {
        const me = await deps.api.me();
        if (me.user.userId !== stored.userId) {
          await deps.storage.clear().catch(() => undefined);
          return null;
        }
        return createAuthSession(me.user.userId);
      } catch (err) {
        if (err instanceof MobileError && err.kind === 'authentication') {
          // The stored session is no longer valid server-side.
          await deps.storage.clear().catch(() => undefined);
          return null;
        }
        // Network/server failure: fail closed by propagating (the provider
        // settles into the authentication-error state).
        throw err;
      }
    },

    async requestOtp(phone) {
      await deps.api.requestOtp(phone);
    },

    async signIn(phone, otp) {
      const result = await deps.api.verifyOtp(phone, otp);
      const session = createAuthSession(result.user.userId);
      await deps.storage.save({
        token: result.token,
        expiresAt: result.expiresAt,
        userId: result.user.userId,
      });
      return session;
    },

    async signOut() {
      await deps.api.logout().catch(() => undefined);
      await deps.storage.clear().catch(() => undefined);
    },
  };
}
