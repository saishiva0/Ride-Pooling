/**
 * Mobile realtime client port (Phase 3.13 — MOBILE FOUNDATION, §14;
 * Phase 3.22 — REALTIME PRODUCTIONIZATION).
 *
 * Provider-neutral boundary for consuming the seven Phase 3.11 realtime events.
 * Phase 3.22 adds the concrete `createSocketRealtimeClient` implementation
 * using Socket.io with authenticated connections, reconnection, and subscription
 * management.
 *
 * The default implementation (`unavailableRealtimeClient`) FAILS CLOSED:
 * `connect()` and `subscribe()` throw a provider-independent
 * `RealtimeUnavailableError`; `disconnect()` is a safe no-op.
 */
import { RealtimeEvent, RealtimeEventType } from './events';

/** Transport lifecycle state. */
export type RealtimeConnectionState =
  'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/** Thrown by the fail-closed client: no realtime transport exists yet. */
export class RealtimeUnavailableError extends Error {
  constructor(
    message = 'Realtime is not configured (backend realtime is disabled; OD-008 is open)',
  ) {
    super(message);
    this.name = 'RealtimeUnavailableError';
  }
}

export interface RealtimeClient {
  readonly connectionState: RealtimeConnectionState;
  /** Connects to the realtime transport. Throws when unavailable. */
  connect(): Promise<void>;
  /** Disconnects. Safe to call when already disconnected. */
  disconnect(): Promise<void>;
  /**
   * Subscribes a handler for one event type and returns an unsubscribe
   * function. Throws when unavailable (fail closed).
   * Idempotent: duplicate subscriptions for the same type return the existing
   * unsubscribe function.
   */
  subscribe(
    type: RealtimeEventType,
    handler: (event: RealtimeEvent) => void,
  ): () => void;
  /**
   * Subscribes to connection state changes (for UI indicators).
   * Returns an unsubscribe function.
   */
  onConnectionStateChange(
    listener: (state: RealtimeConnectionState) => void,
  ): () => void;
  /**
   * Returns true if the current error state is due to authentication failure
   * (invalid/expired/revoked token), which requires sign-out.
   */
  isAuthenticationFailure(): boolean;
}

/** The default fail-closed client (no transport configured). */
export const unavailableRealtimeClient: RealtimeClient = {
  connectionState: 'disconnected',
  async connect() {
    throw new RealtimeUnavailableError();
  },
  async disconnect() {
    // Nothing to disconnect — no transport exists.
  },
  subscribe() {
    throw new RealtimeUnavailableError();
  },
  onConnectionStateChange(listener) {
    listener('disconnected');
    return () => {};
  },
  isAuthenticationFailure() {
    return false;
  },
};
