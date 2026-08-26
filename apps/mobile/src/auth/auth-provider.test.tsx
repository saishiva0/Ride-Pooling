import { describe, expect, it } from 'vitest';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { renderAndSettle, extractText } from '../../tests/render';
import { AuthProvider, useAuth } from './auth-provider';
import {
  AuthenticationUnavailableError,
  unavailableAuthClient,
  type AuthClient,
} from './auth-client';
import type { AuthSession } from './types';

function Probe() {
  const { status, session, isAuthenticated } = useAuth();
  return (
    <Text>
      {status}:{String(isAuthenticated)}:
      {session ? session.user.userId : 'none'}
    </Text>
  );
}

function StateProbe() {
  const { state } = useAuth();
  const detail =
    state.status === 'authentication-error' ? state.error.kind : 'no-error';
  return (
    <Text>
      {state.status}:{detail}
    </Text>
  );
}

function SignInProbe() {
  const { status, session, isAuthenticated, signIn } = useAuth();
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    signIn('+919876543210', '123456').catch((err: unknown) => {
      setFailure(err instanceof Error ? err.name : 'non-error');
    });
  }, [signIn]);
  return (
    <Text>
      {status}:{String(isAuthenticated)}:
      {session ? session.user.userId : 'none'}:{failure ?? 'no-failure'}
    </Text>
  );
}

function SignOutProbe() {
  const { status, session, isAuthenticated, signOut } = useAuth();
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (status === 'authenticated' && !started) {
      setStarted(true);
      signOut();
    }
  }, [status, started, signOut]);
  return (
    <Text>
      {status}:{String(isAuthenticated)}:
      {session ? session.user.userId : 'none'}
    </Text>
  );
}

const sessionFor = (userId: string): AuthSession => ({ user: { userId } });

describe('AuthProvider', () => {
  it('fails closed with the default client: unauthenticated, no session', async () => {
    const root = await renderAndSettle(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(extractText(root.toJSON())).toBe('unauthenticated:false:none');
  });

  it('exposes an authenticated session when the client resolves one', async () => {
    const client: AuthClient = {
      ...unavailableAuthClient,
      getSession: async () => sessionFor('user-1'),
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>,
    );
    expect(extractText(root.toJSON())).toBe('authenticated:true:user-1');
  });

  it('stays in restoring while session restore is unresolved — no session, not authenticated', async () => {
    const client: AuthClient = {
      ...unavailableAuthClient,
      getSession: () => new Promise<AuthSession | null>(() => {}),
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>,
    );
    expect(extractText(root.toJSON())).toBe('restoring:false:none');
  });

  it('settles to authentication-error (fail closed, no session) when session restore rejects', async () => {
    const client: AuthClient = {
      ...unavailableAuthClient,
      getSession: async () => {
        throw new Error('restore failed');
      },
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>,
    );
    expect(extractText(root.toJSON())).toBe('authentication-error:false:none');
  });

  it('normalizes a fail-closed restore failure into the authentication-error state', async () => {
    const client: AuthClient = {
      ...unavailableAuthClient,
      getSession: async () => {
        throw new AuthenticationUnavailableError();
      },
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <StateProbe />
      </AuthProvider>,
    );
    expect(extractText(root.toJSON())).toBe(
      'authentication-error:authentication',
    );
  });

  it('signs in to authenticated via signIn when the client succeeds', async () => {
    const client: AuthClient = {
      ...unavailableAuthClient,
      getSession: () => new Promise<AuthSession | null>(() => {}),
      signIn: async () => sessionFor('user-1'),
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <SignInProbe />
      </AuthProvider>,
    );
    expect(extractText(root.toJSON())).toBe(
      'authenticated:true:user-1:no-failure',
    );
  });

  it('settles to authentication-error and rethrows when signIn fails', async () => {
    const client: AuthClient = {
      ...unavailableAuthClient,
      getSession: () => new Promise<AuthSession | null>(() => {}),
      signIn: async () => {
        throw new AuthenticationUnavailableError();
      },
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <SignInProbe />
      </AuthProvider>,
    );
    expect(extractText(root.toJSON())).toBe(
      'authentication-error:false:none:AuthenticationUnavailableError',
    );
  });

  it('signs out to unauthenticated via signOut', async () => {
    const client: AuthClient = {
      ...unavailableAuthClient,
      getSession: async () => sessionFor('user-1'),
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <SignOutProbe />
      </AuthProvider>,
    );
    expect(extractText(root.toJSON())).toBe('unauthenticated:false:none');
  });
});
