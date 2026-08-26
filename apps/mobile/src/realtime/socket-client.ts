/**
 * Concrete Socket.io realtime client (Phase 3.22 — REALTIME PRODUCTIONIZATION).
 *
 * Implements the `RealtimeClient` port using `socket.io-client`. Connects with
 * the authenticated session's bearer token, manages connection lifecycle,
 * subscriptions, and reconnection — all behind the transport-agnostic interface.
 *
 * Authentication failures (invalid/expired/revoked token) do NOT reconnect;
 * they surface as `error` state so the app can handle sign-out.
 * Transient network failures reconnect with bounded exponential backoff
 * (configured via Socket.io options).
 */
import { io, type Socket } from 'socket.io-client';
import {
  RealtimeClient,
  RealtimeConnectionState,
  RealtimeUnavailableError,
} from './realtime-client';
import { RealtimeEvent, RealtimeEventType } from './events';
import type { AuthHeadersProvider } from '../auth/auth-headers';

/** Internal connection state with reconnecting support. */
type InternalConnectionState =
  'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/** Subscription entry for duplicate prevention. */
interface SubscriptionEntry {
  handler: (event: RealtimeEvent) => void;
  off: () => void;
}

/** Creates the concrete Socket.io realtime client. */
export function createSocketRealtimeClient(
  authHeadersProvider: AuthHeadersProvider,
  realtimeUrl: string,
): RealtimeClient {
  let socket: Socket | null = null;
  let connectionState: InternalConnectionState = 'disconnected';
  const subscriptions = new Map<RealtimeEventType, SubscriptionEntry>();
  let isAuthFailure = false;

  /** Notify listeners of connection state change. */
  const stateListeners = new Set<(state: RealtimeConnectionState) => void>();

  function setConnectionState(newState: InternalConnectionState) {
    if (connectionState !== newState) {
      connectionState = newState;
      const publicState: RealtimeConnectionState =
        newState === 'reconnecting' ? 'connecting' : newState;
      stateListeners.forEach((listener) => {
        try {
          listener(publicState);
        } catch {
          // Ignore listener errors
        }
      });
    }
  }

  /** Get current auth token from provider. */
  async function getAuthToken(): Promise<string | null> {
    const headers = await authHeadersProvider.getAuthHeaders();
    return headers?.Authorization?.replace(/^Bearer\s+/i, '') ?? null;
  }

  /** Build socket with current token. */
  async function buildSocket(): Promise<Socket> {
    const token = await getAuthToken();
    if (!token) {
      throw new RealtimeUnavailableError('No authentication token available');
    }

    const newSocket = io(realtimeUrl, {
      path: '/ws',
      extraHeaders: { Authorization: `Bearer ${token}` },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: 10000,
      autoConnect: false,
    });

    // Connection lifecycle handlers
    newSocket.on('connect', () => {
      isAuthFailure = false;
      setConnectionState('connected');
    });

    newSocket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        // Server explicitly disconnected (e.g., auth failure after connect)
        // Socket.io will NOT auto-reconnect; we handle this as error
        isAuthFailure = true;
        setConnectionState('error');
      } else if (
        newSocket.io.engine &&
        (newSocket.io.engine as { _reconnecting?: boolean })._reconnecting
      ) {
        // Transient disconnect — Socket.io will attempt reconnect
        setConnectionState('reconnecting');
      } else {
        // Clean disconnect (client-called disconnect())
        setConnectionState('disconnected');
      }
    });

    newSocket.on('connect_error', (err: Error) => {
      // Authentication failures: invalid token, expired, revoked, etc.
      // Socket.io treats these as connection errors; we detect and stop retrying
      const msg = err.message?.toLowerCase() ?? '';
      if (
        msg.includes('auth') ||
        msg.includes('unauthorized') ||
        msg.includes('401') ||
        msg.includes('authentication failed')
      ) {
        isAuthFailure = true;
        setConnectionState('error');
      } else {
        // Network/transient error — Socket.io will retry
        setConnectionState('reconnecting');
      }
    });

    newSocket.on('reconnect_attempt', () => {
      if (!isAuthFailure) {
        setConnectionState('reconnecting');
      }
    });

    newSocket.on('reconnect', () => {
      isAuthFailure = false;
      setConnectionState('connected');
    });

    newSocket.on('reconnect_failed', () => {
      if (!isAuthFailure) {
        setConnectionState('error');
      }
    });

    // Re-register subscriptions on (re)connect
    newSocket.on('connect', () => {
      // Subscriptions are automatically re-registered because Socket.io
      // re-attaches listeners on reconnect. But we ensure the room is joined
      // by the server via the authentication flow.
      subscriptions.forEach((entry, type) => {
        // Re-attach handler to new socket instance
        newSocket.on(type, entry.handler);
      });
    });

    return newSocket;
  }

  return {
    get connectionState(): RealtimeConnectionState {
      const publicState: RealtimeConnectionState =
        connectionState === 'reconnecting' ? 'connecting' : connectionState;
      return publicState;
    },

    async connect(): Promise<void> {
      if (socket?.connected) {
        return; // Already connected
      }
      if (
        connectionState === 'connecting' ||
        connectionState === 'reconnecting'
      ) {
        return; // Connection in progress
      }

      setConnectionState('connecting');

      try {
        socket = await buildSocket();
        socket.connect();
      } catch (err) {
        setConnectionState('error');
        if (err instanceof RealtimeUnavailableError) {
          throw err;
        }
        throw new RealtimeUnavailableError(
          'Failed to initialize realtime connection',
        );
      }
    },

    async disconnect(): Promise<void> {
      isAuthFailure = false;
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
      }
      setConnectionState('disconnected');
    },

    subscribe(
      type: RealtimeEventType,
      handler: (event: RealtimeEvent) => void,
    ): () => void {
      // Prevent duplicate subscriptions for the same event type
      if (subscriptions.has(type)) {
        const existing = subscriptions.get(type)!;
        // Return the existing unsubscribe to maintain idempotency
        return existing.off;
      }

      if (!socket) {
        throw new RealtimeUnavailableError(
          'Not connected — call connect() first',
        );
      }

      // Attach handler
      socket.on(type, handler);

      const off = () => {
        if (socket) {
          socket.off(type, handler);
        }
        subscriptions.delete(type);
      };

      subscriptions.set(type, { handler, off });
      return off;
    },

    /** Subscribe to connection state changes (for UI indicators). */
    onConnectionStateChange(
      listener: (state: RealtimeConnectionState) => void,
    ): () => void {
      stateListeners.add(listener);
      // Immediately notify with current state
      const publicState: RealtimeConnectionState =
        connectionState === 'reconnecting' ? 'connecting' : connectionState;
      listener(publicState);
      return () => stateListeners.delete(listener);
    },

    /** Check if the current failure is an authentication failure (requires sign-out). */
    isAuthenticationFailure(): boolean {
      return isAuthFailure;
    },
  };
}

/** Type guard for authentication failure detection. */
export function isRealtimeAuthFailure(
  error: unknown,
): error is Error & { isAuthFailure: true } {
  return error instanceof Error && 'isAuthFailure' in error;
}
