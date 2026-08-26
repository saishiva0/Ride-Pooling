/**
 * Mobile authentication session types (Phase 3.13 — MOBILE FOUNDATION, §10;
 * Phase 3.14 — MOBILE AUTHENTICATION & IDENTITY BOUNDARY, §8/§9;
 * Phase 3.18 — OD-005 resolved).
 *
 * OD-005 was RESOLVED in Phase 3.18 (phone + OTP via MSG91, opaque bearer
 * sessions — the token itself never enters these types). They mirror the
 * Phase 3.9 identity contract (`AuthenticatedUser { userId }`,
 * `AuthenticationResult { user }`) structurally: same shape, no conversion
 * needed, and never carrying credentials, tokens, provider data, or backend
 * database records (Phase 3.14 §8). They are deliberately NOT imported from
 * the backend module (package boundary — mobile cannot depend on backend-only
 * modules).
 *
 * Phase 3.14 strengthens the state model to an explicit discriminated union
 * (restoring / unauthenticated / authenticated / authentication-error) so the
 * UI can never ambiguously render authenticated content while session
 * restoration is unresolved (Phase 3.14 §9/§10).
 */
import { MobileError } from '../api/errors';

/** A user proven authenticated by the authentication boundary. */
export interface AuthenticatedUser {
  readonly userId: string;
}

/** An authenticated session: the identity the rest of the app may trust. */
export interface AuthSession {
  readonly user: AuthenticatedUser;
}

/**
 * Session lifecycle. 'restoring' while the stored session is being restored;
 * 'authenticated'/'unauthenticated' once resolved; 'authentication-error' when
 * a session restore or sign-in failed (fail-closed — no session is exposed).
 */
export type AuthStatus =
  'restoring' | 'unauthenticated' | 'authenticated' | 'authentication-error';

/**
 * Explicit discriminated-union state model (Phase 3.14 §9). The app
 * distinguishes four states and never reduces authentication to an ambiguous
 * boolean. 'authentication-error' still fails closed: no session is carried,
 * so no authenticated content can render.
 */
export type AuthState =
  | { readonly status: 'restoring' }
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'authenticated'; readonly session: AuthSession }
  | { readonly status: 'authentication-error'; readonly error: MobileError };

/** The only legitimate entry point for building an authenticated identity. */
export function createAuthenticatedUser(userId: string): AuthenticatedUser {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new MobileError(
      'validation',
      'AuthenticatedUser requires a non-blank userId',
    );
  }
  return { userId };
}

/** Builds an authenticated session from a validated user id. */
export function createAuthSession(userId: string): AuthSession {
  return { user: createAuthenticatedUser(userId) };
}

/** Structural guard: an object with a non-blank string `userId`. */
export function isAuthenticatedUser(
  value: unknown,
): value is AuthenticatedUser {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const userId = (value as { userId?: unknown }).userId;
  return typeof userId === 'string' && userId.trim() !== '';
}

/** Structural guard: an authenticated session with a valid user. */
export function isAuthSession(value: unknown): value is AuthSession {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return isAuthenticatedUser((value as { user?: unknown }).user);
}

export function isRestoring(
  state: AuthState,
): state is { readonly status: 'restoring' } {
  return state.status === 'restoring';
}

export function isUnauthenticated(
  state: AuthState,
): state is { readonly status: 'unauthenticated' } {
  return state.status === 'unauthenticated';
}

export function isAuthenticatedState(state: AuthState): state is {
  readonly status: 'authenticated';
  readonly session: AuthSession;
} {
  return state.status === 'authenticated';
}

export function isAuthenticationError(state: AuthState): state is {
  readonly status: 'authentication-error';
  readonly error: MobileError;
} {
  return state.status === 'authentication-error';
}
