import { describe, expect, it } from 'vitest';
import { MobileError } from '../api/errors';
import { AuthenticationUnavailableError } from './auth-client';
import { normalizeAuthError } from './errors';

describe('normalizeAuthError (auth error normalization)', () => {
  it('maps the fail-closed unavailable error to an authentication kind with a generic message', () => {
    const err = new AuthenticationUnavailableError();
    const normalized = normalizeAuthError(err);
    expect(normalized).toBeInstanceOf(MobileError);
    expect(normalized.kind).toBe('authentication');
    // User-facing copy only — no internal/technical references.
    expect(normalized.message).not.toContain('secret');
    expect(normalized.message).not.toContain('OD-005');
  });

  it('passes an already-normalized MobileError through unchanged', () => {
    const original = new MobileError('timeout', 'Request timed out', {
      statusCode: 408,
    });
    const normalized = normalizeAuthError(original);
    expect(normalized).toBe(original);
    expect(normalized.kind).toBe('timeout');
  });

  it('classifies a plain failure without leaking the raw message', () => {
    const normalized = normalizeAuthError(new Error('secret restore detail'));
    expect(normalized).toBeInstanceOf(MobileError);
    expect(normalized.kind).toBe('unknown');
    expect(normalized.message).not.toContain('secret restore detail');
  });

  it('classifies a transport failure as network without leaking raw internals', () => {
    const normalized = normalizeAuthError(new TypeError('socket closed'));
    expect(normalized.kind).toBe('network');
    expect(normalized.message).not.toContain('socket closed');
  });

  it('never surfaces stack traces or raw error objects', () => {
    const normalized = normalizeAuthError(
      new Error('boom with credentials inside'),
    );
    expect(normalized.details).toBeUndefined();
    expect(String(normalized)).not.toContain('credentials');
    expect(normalized.message).not.toContain('boom');
  });
});
