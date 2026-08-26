import { describe, expect, it } from 'vitest';
import { MobileError } from '../api/errors';
import {
  createAuthenticatedUser,
  createAuthSession,
  isAuthenticatedUser,
  isAuthenticatedState,
  isAuthenticationError,
  isAuthSession,
  isRestoring,
  isUnauthenticated,
} from './types';

describe('authenticated identity factories (Phase 3.14 §8)', () => {
  it('builds a minimal identity carrying only the userId', () => {
    expect(createAuthenticatedUser('user-1')).toEqual({ userId: 'user-1' });
    expect(createAuthSession('user-1')).toEqual({
      user: { userId: 'user-1' },
    });
  });

  it('rejects blank user ids (validation, fail closed)', () => {
    for (const bad of ['', '   ', undefined as unknown as string]) {
      expect(() => createAuthenticatedUser(bad)).toThrow(MobileError);
    }
  });

  it('never attaches credentials, tokens, or provider data to the identity', () => {
    const session = createAuthSession('user-1');
    expect(Object.keys(session)).toEqual(['user']);
    expect(Object.keys(session.user)).toEqual(['userId']);
  });
});

describe('identity structural guards', () => {
  it('accepts a non-blank userId', () => {
    expect(isAuthenticatedUser({ userId: 'user-1' })).toBe(true);
  });

  it('rejects malformed identities (fail closed)', () => {
    expect(isAuthenticatedUser(null)).toBe(false);
    expect(isAuthenticatedUser('user-1')).toBe(false);
    expect(isAuthenticatedUser({})).toBe(false);
    expect(isAuthenticatedUser({ userId: '' })).toBe(false);
    expect(isAuthenticatedUser({ userId: 42 })).toBe(false);
  });

  it('isAuthSession requires a valid user', () => {
    expect(isAuthSession({ user: { userId: 'user-1' } })).toBe(true);
    expect(isAuthSession({ user: { userId: '' } })).toBe(false);
    expect(isAuthSession({})).toBe(false);
  });
});

describe('AuthState guards (discriminated union)', () => {
  it('distinguishes all four states without ambiguity', () => {
    expect(isRestoring({ status: 'restoring' })).toBe(true);
    expect(isUnauthenticated({ status: 'unauthenticated' })).toBe(true);
    expect(
      isAuthenticatedState({
        status: 'authenticated',
        session: { user: { userId: 'u' } },
      }),
    ).toBe(true);
    expect(
      isAuthenticationError({
        status: 'authentication-error',
        error: new MobileError('authentication', 'nope'),
      }),
    ).toBe(true);
  });

  it('rejects cross-state classification (mutually exclusive)', () => {
    expect(isAuthenticatedState({ status: 'restoring' })).toBe(false);
    expect(isAuthenticationError({ status: 'unauthenticated' })).toBe(false);
    expect(
      isRestoring({
        status: 'authenticated',
        session: { user: { userId: 'u' } },
      }),
    ).toBe(false);
  });
});
