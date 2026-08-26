/**
 * Unit tests for the in-memory OTP rate limiter (OD-005 — Phase 3.18).
 */
import { describe, expect, it } from 'vitest';
import { createInMemoryOtpRateLimiter } from './rate-limiter.js';

describe('createInMemoryOtpRateLimiter', () => {
  it('allows up to `limit` attempts within the window', () => {
    const limiter = createInMemoryOtpRateLimiter();
    const limit = 3;
    const windowMs = 1000;
    expect(limiter.allow('k', limit, windowMs, 1000)).toBe(true);
    expect(limiter.allow('k', limit, windowMs, 1100)).toBe(true);
    expect(limiter.allow('k', limit, windowMs, 1200)).toBe(true);
    expect(limiter.allow('k', limit, windowMs, 1300)).toBe(false);
  });

  it('tracks keys independently', () => {
    const limiter = createInMemoryOtpRateLimiter();
    expect(limiter.allow('a', 1, 1000, 0)).toBe(true);
    expect(limiter.allow('b', 1, 1000, 0)).toBe(true);
    expect(limiter.allow('a', 1, 1000, 1)).toBe(false);
    expect(limiter.allow('b', 1, 1000, 1)).toBe(false);
  });

  it('releases the window once attempts age out', () => {
    const limiter = createInMemoryOtpRateLimiter();
    const limit = 1;
    const windowMs = 1000;
    expect(limiter.allow('k', limit, windowMs, 0)).toBe(true);
    expect(limiter.allow('k', limit, windowMs, 500)).toBe(false);
    expect(limiter.allow('k', limit, windowMs, 1001)).toBe(true);
  });
});
