/**
 * AuthProvider (Phase 3.13 — MOBILE FOUNDATION, §10; Phase 3.14 — §9/§10;
 * Phase 3.18 — OD-005 resolved; Phase 3.22 — REALTIME PRODUCTIONIZATION).
 *
 * React context bridge between the `AuthClient` port and the UI. Phase 3.14
 * strengthens the state model to an explicit discriminated union:
 *
 *   restoring            → deterministic splash boundary
 *   unauthenticated      → auth (public) boundary
 *   authenticated        → authenticated app boundary
 *   authentication-error → auth (public) boundary, fail closed, error recorded
 *
 * Exposes `state` (canonical), plus derived `status`, `session`, and
 * `isAuthenticated` projections. Session restore settles exactly one way via
 * the pure `session-restore` helpers: a resolved session → authenticated, a
 * resolved null → unauthenticated, a rejection → authentication-error with a
 * normalized error (no raw provider detail, no infinite retry loop).
 *
 * Phase 3.18: `requestOtp` and `signIn(phone, otp)` are the real phone+OTP
 * capabilities. Without an injected client the provider builds the concrete
 * `createAuthClient` (secure storage + backend validation). The provider also
 * owns the `AuthHeadersProvider` that the API client uses, and wraps its
 * `onAuthenticationFailure` hook so a rejected session settles the app into
 * * the unauthenticated boundary. The UI never touches credentials or tokens —
 * it only observes state and calls the two auth operations.
 *
 * Phase 3.22: Manages the realtime client lifecycle — connects when
 * authenticated, disconnects on sign-out or auth failure.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthClient } from './auth-client';
import type {
  RealtimeClient,
  RealtimeConnectionState,
} from '../realtime/realtime-client';
import { createDefaultAuthDependencies } from './create-default-auth-dependencies';
import { authStateFromFailure, authStateFromSession } from './session-restore';
import type { AuthHeadersProvider } from './auth-headers';
import type { AuthSession, AuthState, AuthStatus } from './types';
import { deactivateCurrentDeviceTokens } from '../notifications';

export interface AuthContextValue {
  /** Canonical discriminated-union state (Phase 3.14 §9). */
  state: AuthState;
  /** Derived string projection of `state` (backward-compatible). */
  status: AuthStatus;
  /** Derived: the authenticated session, or null unless authenticated. */
  session: AuthSession | null;
  /** Derived: true only in the 'authenticated' state. */
  isAuthenticated: boolean;
  /** The headers provider wired for this session (used by the API client). */
  headersProvider: AuthHeadersProvider;
  /** The realtime client for this session (Phase 3.22). */
  realtimeClient: RealtimeClient;
  /** Requests a fresh OTP for a phone (Phase 3.18). */
  requestOtp: (phone: string) => Promise<void>;
  /** Verifies a phone + OTP and signs the user in (Phase 3.18). */
  signIn: (phone: string, otp: string) => Promise<AuthSession>;
  signOut: () => Promise<void>;
  /** Registers a callback for auth state changes (Phase 3.23). */
  onStateChange: (callback: (state: AuthStatus) => void) => () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  /** Injectable for tests; defaults to the concrete phone+OTP client. */
  client?: AuthClient;
  /** Injectable for tests; defaults to the stored secure-storage provider. */
  headersProvider?: AuthHeadersProvider;
  /** Injectable for tests; defaults to the concrete Socket.io client. */
  realtimeClient?: RealtimeClient;
  children: ReactNode;
}

export function AuthProvider({
  client: clientProp,
  headersProvider: headersProviderProp,
  realtimeClient: realtimeClientProp,
  children,
}: AuthProviderProps) {
  const defaults = useMemo(() => createDefaultAuthDependencies(), []);
  const client = clientProp ?? defaults.client;
  const realtimeClient = realtimeClientProp ?? defaults.realtimeClient;

  const [state, setState] = useState<AuthState>({ status: 'restoring' });
  const [stateChangeCallbacks, setStateChangeCallbacks] = useState<
    Array<(state: AuthStatus) => void>
  >([]);

  // Notify state change callbacks
  const setStateWithCallbacks = useCallback(
    (newState: AuthState) => {
      setState(newState);
      stateChangeCallbacks.forEach((callback) => {
        try {
          callback(newState.status);
        } catch (error) {
          console.error('State change callback error:', error);
        }
      });
    },
    [stateChangeCallbacks],
  );

  useEffect(() => {
    let cancelled = false;
    client
      .getSession()
      .then((resolved) => {
        if (cancelled) {
          return;
        }
        setStateWithCallbacks(authStateFromSession(resolved));
      })
      .catch((err: unknown) => {
        // Session restore must fail closed: never render authenticated content,
        // never surface raw provider details, never loop indefinitely.
        if (!cancelled) {
          setStateWithCallbacks(authStateFromFailure(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, setStateWithCallbacks]);

  // The effective headers provider handed to the API client. Its failure hook
  // clears the persisted session (the underlying provider's own behavior) and
  // then settles the app into the unauthenticated boundary.
  const headersProvider = useMemo<AuthHeadersProvider>(() => {
    const base = headersProviderProp ?? defaults.headersProvider;
    const original = base.onAuthenticationFailure;
    return {
      ...base,
      onAuthenticationFailure() {
        original?.();
        setStateWithCallbacks({ status: 'unauthenticated' });
      },
    };
  }, [headersProviderProp, defaults.headersProvider, setStateWithCallbacks]);

  // Phase 3.22: Manage realtime connection lifecycle with auth state
  useEffect(() => {
    if (state.status === 'authenticated') {
      realtimeClient.connect().catch(() => {
        // Connection error handled by realtime client state
      });
    } else {
      realtimeClient.disconnect();
    }
  }, [state.status, realtimeClient]);

  // Phase 3.22: Handle realtime authentication failure (token expired/revoked)
  useEffect(() => {
    const unsubscribe = realtimeClient.onConnectionStateChange(
      (connectionState: RealtimeConnectionState) => {
        if (
          connectionState === 'error' &&
          realtimeClient.isAuthenticationFailure()
        ) {
          // Token is invalid/expired/revoked — sign out
          client.signOut();
          setStateWithCallbacks({ status: 'unauthenticated' });
        }
      },
    );
    return unsubscribe;
  }, [client, realtimeClient, setStateWithCallbacks]);

  const requestOtp = useCallback(
    async (phone: string): Promise<void> => {
      await client.requestOtp(phone);
    },
    [client],
  );

  const signIn = useCallback(
    async (phone: string, otp: string): Promise<AuthSession> => {
      try {
        const resolved = await client.signIn(phone, otp);
        setStateWithCallbacks({ status: 'authenticated', session: resolved });
        return resolved;
      } catch (err) {
        setStateWithCallbacks(authStateFromFailure(err));
        throw err;
      }
    },
    [client, setStateWithCallbacks],
  );

  const signOut = useCallback(async (): Promise<void> => {
    await client.signOut();
    // Deactivate push tokens on logout (best effort)
    await deactivateCurrentDeviceTokens();
    setStateWithCallbacks({ status: 'unauthenticated' });
  }, [client, setStateWithCallbacks]);

  const value = useMemo<AuthContextValue>(() => {
    const session = state.status === 'authenticated' ? state.session : null;
    return {
      state,
      status: state.status,
      session,
      isAuthenticated: state.status === 'authenticated',
      headersProvider,
      realtimeClient,
      requestOtp,
      signIn,
      signOut,
      onStateChange: (callback: (state: AuthStatus) => void) => {
        setStateChangeCallbacks((prev) => [...prev, callback]);
        return () => {
          setStateChangeCallbacks((prev) =>
            prev.filter((cb) => cb !== callback),
          );
        };
      },
    };
  }, [
    state,
    headersProvider,
    realtimeClient,
    requestOtp,
    signIn,
    signOut,
    stateChangeCallbacks,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Reads the auth context; throws outside an AuthProvider (fail fast). */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
