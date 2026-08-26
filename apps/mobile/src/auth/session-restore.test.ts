import { describe, expect, it } from 'vitest';
import { AuthenticationUnavailableError } from './auth-client';
import { authStateFromFailure, authStateFromSession } from './session-restore';
import { isAuthenticationError, isAuthenticatedState } from './types';

describe('authStateFromSession (session restoration classification)', () => {
  it('maps a resolved session to the authenticated state with that session', () => {
    const session = { user: { userId: 'user-1' } };
    const state = authStateFromSession(session);
    expect(isAuthenticatedState(state)).toBe(true);
    if (isAuthenticatedState(state)) {
      expect(state.session).toBe(session);
    }
  });

  it('maps a resolved null to the unauthenticated state (fail closed)', () => {
    const state = authStateFromSession(null);
    expect(state.status).toBe('unauthenticated');
  });

  it('never substitutes a different identity than the one resolved', () => {
    const session = { user: { userId: 'user-a' } };
    const state = authStateFromSession(session);
    expect(isAuthenticatedState(state)).toBe(true);
    if (isAuthenticatedState(state)) {
      expect(state.session.user.userId).toBe('user-a');
    }
  });
});

describe('authStateFromFailure (restore/sign-in failure classification)', () => {
  it('maps a rejection to the authentication-error state with a normalized error', () => {
    const state = authStateFromFailure(new Error('raw provider detail'));
    expect(isAuthenticationError(state)).toBe(true);
    if (isAuthenticationError(state)) {
      expect(state.error.message).not.toContain('raw provider detail');
    }
  });

  it('maps an auth-flavored failure to an authentication kind', () => {
    const state = authStateFromFailure(new AuthenticationUnavailableError());
    expect(isAuthenticationError(state)).toBe(true);
    if (isAuthenticationError(state)) {
      expect(state.error.kind).toBe('authentication');
    }
  });

  it('always fails closed: the error state carries no session', () => {
    const state = authStateFromFailure(new Error('nope'));
    expect(state.status).toBe('authentication-error');
    expect('session' in state).toBe(false);
  });
});
