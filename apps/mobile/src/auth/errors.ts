/**
 * Normalized authentication errors (Phase 3.14 — §7/§10/§18; Phase 3.18 —
 * OD-005 resolved).
 *
 * With OD-005 resolved, auth failures come from the real flow (backend 401s,
 * rejected sessions) and from the fail-closed `AuthenticationUnavailableError`
 * when an app is built without a client. `normalizeAuthError` maps ANY thrown
 * value into the shared `MobileError` model so auth failures settle into the
 * `authentication-error` state without leaking raw provider/transport detail,
 * stack traces, credentials, or tokens (Phase 3.14 §15).
 */
import { MobileError, toMobileError } from '../api/errors';
import { AuthenticationUnavailableError } from './auth-client';

/**
 * Normalizes an authentication failure into a `MobileError`. Already-normalized
 * errors pass through unchanged; the fail-closed unavailable error becomes an
 * 'authentication' kind; everything else is classified by the shared transport
 * normalizer. Raw error objects never reach UI state.
 */
export function normalizeAuthError(err: unknown): MobileError {
  if (err instanceof MobileError) {
    return err;
  }
  if (err instanceof AuthenticationUnavailableError) {
    return new MobileError('authentication', err.message, { cause: err });
  }
  return toMobileError(err);
}
