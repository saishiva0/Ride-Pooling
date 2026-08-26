/**
 * OTP rate limiter (OD-005 — Phase 3.18).
 *
 * A minimal sliding-window limiter, keyed by phone, used for both OTP
 * requests and verify attempts. It is deliberately simple and in-memory:
 * documented single-instance behavior (fine for V1's single-module backend;
 * see `docs/development/phase-3-18-notes.md` for the limitation and the
 * future distributed alternative).
 *
 * `now` is injectable so tests are deterministic.
 */

/** A per-key sliding-window allowance check. */
export interface OtpRateLimiter {
  /**
   * Returns `true` when `key` is allowed (and records the attempt). When the
   * window already holds `limit` attempts, returns `false`.
   */
  allow(key: string, limit: number, windowMs: number, now?: number): boolean;
}

/** Builds the default in-memory limiter. */
export function createInMemoryOtpRateLimiter(): OtpRateLimiter {
  const buckets = new Map<string, number[]>();

  return {
    allow(key, limit, windowMs, now = Date.now()) {
      const cutoff = now - windowMs;
      const retained = (buckets.get(key) ?? []).filter((t) => t > cutoff);
      if (retained.length >= limit) {
        buckets.set(key, retained);
        return false;
      }
      retained.push(now);
      buckets.set(key, retained);
      return true;
    },
  };
}
