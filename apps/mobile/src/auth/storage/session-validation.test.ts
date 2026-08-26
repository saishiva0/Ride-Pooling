/**
 * Stored-session validation tests (Phase 3.18 — OD-005 resolved).
 *
 * A malformed/legacy stored payload must FAIL CLOSED as "no session" — it is
 * never surfaced, never treated as a session, and never crashes the app.
 */
import { describe, expect, it } from 'vitest';
import { parseStoredSession } from './session-validation';

const valid = {
  token: 'token-1',
  expiresAt: '2026-09-18T10:05:00.000Z',
  userId: 'user-1',
};

describe('parseStoredSession', () => {
  it('accepts a well-formed stored session', () => {
    expect(parseStoredSession(valid)).toEqual(valid);
  });

  it('accepts a future-dated expiry (still within parseable ISO range)', () => {
    expect(
      parseStoredSession({ ...valid, expiresAt: '2030-01-01T00:00:00.000Z' }),
    ).not.toBeNull();
  });

  it('rejects non-object payloads (fail closed)', () => {
    expect(parseStoredSession(null)).toBeNull();
    expect(parseStoredSession(undefined)).toBeNull();
    expect(parseStoredSession('payload')).toBeNull();
    expect(parseStoredSession(42)).toBeNull();
    expect(parseStoredSession([])).toBeNull();
  });

  it('rejects a missing or blank token', () => {
    expect(parseStoredSession({ ...valid, token: '' })).toBeNull();
    expect(parseStoredSession({ ...valid, token: '   ' })).toBeNull();
    expect(parseStoredSession({ ...valid, token: 42 })).toBeNull();
  });

  it('rejects a missing or blank userId', () => {
    expect(parseStoredSession({ ...valid, userId: '' })).toBeNull();
    expect(parseStoredSession({ ...valid, userId: '   ' })).toBeNull();
    expect(parseStoredSession({ ...valid, userId: null })).toBeNull();
  });

  it('rejects a missing or unparseable expiresAt', () => {
    expect(parseStoredSession({ ...valid, expiresAt: '' })).toBeNull();
    expect(parseStoredSession({ ...valid, expiresAt: 'nope' })).toBeNull();
    expect(parseStoredSession({ ...valid, expiresAt: 0 })).toBeNull();
  });

  it('ignores unknown extra fields (forward-compatible)', () => {
    expect(parseStoredSession({ ...valid, refreshToken: 'ignored' })).toEqual(
      valid,
    );
  });
});
