/**
 * Unit tests for the provider-independent identity types (Phase 3.9).
 *
 * Focus: identity creation, structural guards, minimal payload (no credential
 * fields ever leak into the identity), and identity isolation (one user's
 * identity can never be confused with another's).
 */
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../lib/errors.js';
import {
  createAuthenticationResult,
  createAuthenticatedUser,
  isAuthenticatedUser,
  type AuthenticatedUser,
} from './identity.js';

describe('createAuthenticatedUser', () => {
  it('creates an identity carrying exactly the user id', () => {
    const identity = createAuthenticatedUser('user-123');

    expect(identity.userId).toBe('user-123');
    // Minimal payload: the identity exposes nothing but the user id — no
    // credentials, hashes, tokens, or provider data can leak.
    expect(Object.keys(identity)).toEqual(['userId']);
  });

  it('rejects a blank or missing user id', () => {
    expect(() => createAuthenticatedUser('')).toThrow(ValidationError);
    expect(() => createAuthenticatedUser('   ')).toThrow(ValidationError);
  });

  it('rejects a non-string user id at the type boundary', () => {
    // Runtime guard for untyped input paths.
    expect(() => createAuthenticatedUser(42 as unknown as string)).toThrow(
      ValidationError,
    );
  });
});

describe('isAuthenticatedUser', () => {
  it('accepts a structurally valid identity', () => {
    expect(isAuthenticatedUser({ userId: 'user-1' })).toBe(true);
  });

  it('rejects malformed identity shapes', () => {
    expect(isAuthenticatedUser(undefined)).toBe(false);
    expect(isAuthenticatedUser(null)).toBe(false);
    expect(isAuthenticatedUser('user-1')).toBe(false);
    expect(isAuthenticatedUser(42)).toBe(false);
    expect(isAuthenticatedUser({})).toBe(false);
    expect(isAuthenticatedUser({ userId: '' })).toBe(false);
    expect(isAuthenticatedUser({ userId: '   ' })).toBe(false);
    expect(isAuthenticatedUser({ userId: 42 })).toBe(false);
  });
});

describe('identity isolation', () => {
  it('distinguishes one user from another', () => {
    const alice = createAuthenticatedUser('alice');
    const bob = createAuthenticatedUser('bob');

    expect(alice.userId).not.toBe(bob.userId);
  });

  it('never cross-contaminates identities', () => {
    const alice: AuthenticatedUser = { userId: 'alice' };
    const bob: AuthenticatedUser = { userId: 'bob' };

    expect(alice.userId).toBe('alice');
    expect(bob.userId).toBe('bob');
    expect(bob.userId).not.toBe(alice.userId);
  });
});

describe('createAuthenticationResult', () => {
  it('wraps the identity in the result shape', () => {
    const result = createAuthenticationResult('user-9');

    expect(result).toEqual({ user: { userId: 'user-9' } });
    // The result exposes only the identity — no credentials or tokens.
    expect(Object.keys(result)).toEqual(['user']);
    expect(Object.keys(result.user)).toEqual(['userId']);
  });

  it('fails for a blank user id', () => {
    expect(() => createAuthenticationResult('')).toThrow(ValidationError);
  });
});
