/**
 * Session restoration abstraction (Phase 3.14 — §9/§10/§18).
 *
 * Pure, deterministic mappings from a session-restore (or sign-in) outcome to
 * the discriminated-union `AuthState`. The provider and tests use these instead
 * of ad-hoc transitions, so every outcome settles exactly one way and always
 * fails closed:
 *
 *   resolved session → authenticated
 *   resolved null     → unauthenticated
 *   rejected          → authentication-error (normalized, no sensitive detail)
 *
 * No network, no provider, no storage lives here — the client port provides the
 * outcome and these helpers classify it.
 */
import { normalizeAuthError } from './errors';
import type { AuthSession, AuthState } from './types';

/** Classifies a successful session restore result. */
export function authStateFromSession(session: AuthSession | null): AuthState {
  if (session === null) {
    return { status: 'unauthenticated' };
  }
  return { status: 'authenticated', session };
}

/** Classifies a failed session restore / sign-in into a fail-closed error state. */
export function authStateFromFailure(err: unknown): AuthState {
  return { status: 'authentication-error', error: normalizeAuthError(err) };
}
