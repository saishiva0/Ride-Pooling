/**
 * Persisted session storage types (Phase 3.18 — OD-005 resolved).
 *
 * The device persists ONLY what it needs to re-attach the bearer token on a
 * later launch: the opaque token, its expiry, and the user id it belongs to.
 * No OTP, no password, no provider secrets are ever stored.
 */

/** The persisted session payload. `expiresAt` is an ISO-8601 timestamp. */
export interface StoredSession {
  token: string;
  expiresAt: string;
  userId: string;
}

/** The storage seam (secure storage in production, memory in tests). */
export interface SessionStorage {
  /** The stored session, or null when none exists. */
  get(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}
