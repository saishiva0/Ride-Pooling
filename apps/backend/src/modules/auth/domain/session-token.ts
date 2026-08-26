/**
 * Session token primitives (OD-005 — resolved Phase 3.18: phone + OTP).
 *
 * Sessions are opaque bearer tokens: 32 random bytes, base64url-encoded. The
 * token is returned to the client exactly once at issuance and never stored,
 * logged, or hashed-in-log. Persistence stores only a SHA-256 hash
 * (`AuthSession.tokenHash`, unique), so a database leak cannot be replayed as
 * credentials and tokens are compared by hash lookup.
 *
 * There is deliberately no refresh token in V1 (OD-005 resolution).
 */
import { createHash, randomBytes } from 'node:crypto';

/** Random token entropy in bytes. */
export const SESSION_TOKEN_BYTES = 32;

/** Hash algorithm used to store the token. */
export const SESSION_TOKEN_HASH_ALGORITHM = 'sha256';

/** Default session lifetime in days (configurable via SESSION_TTL_DAYS). */
export const DEFAULT_SESSION_TTL_DAYS = 30;

/** Generates a new opaque session token. */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/** SHA-256 hash of a session token (the only thing persisted). */
export function hashSessionToken(token: string): string {
  return createHash(SESSION_TOKEN_HASH_ALGORITHM).update(token).digest('hex');
}

/** Expiry instant `ttlDays` after `now`. */
export function sessionExpiryFromNow(
  now: Date,
  ttlDays: number = DEFAULT_SESSION_TTL_DAYS,
): Date {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}
