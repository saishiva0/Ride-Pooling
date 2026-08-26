/**
 * Unit tests for session token primitives (OD-005 — Phase 3.18).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_TTL_DAYS,
  SESSION_TOKEN_BYTES,
  generateSessionToken,
  hashSessionToken,
  sessionExpiryFromNow,
} from './session-token.js';

describe('generateSessionToken', () => {
  it('produces a unique opaque base64url token', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(a, 'utf8')).toBeGreaterThan(SESSION_TOKEN_BYTES);
  });

  it('is not persisted-readable: hashing never reveals the token', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).not.toContain(token);
  });
});

describe('hashSessionToken', () => {
  it('is deterministic for the same token', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it('differs for different tokens', () => {
    expect(hashSessionToken('a')).not.toBe(hashSessionToken('b'));
  });
});

describe('sessionExpiryFromNow', () => {
  it('computes the expiry from a base instant and TTL', () => {
    const now = new Date('2026-08-19T00:00:00.000Z');
    const expiry = sessionExpiryFromNow(now, 30);
    expect(expiry.toISOString()).toBe('2026-09-18T00:00:00.000Z');
  });

  it('defaults to the standard 30-day TTL', () => {
    const now = new Date('2026-08-19T00:00:00.000Z');
    const expiry = sessionExpiryFromNow(now);
    expect(expiry.getTime() - now.getTime()).toBe(
      DEFAULT_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
  });
});
