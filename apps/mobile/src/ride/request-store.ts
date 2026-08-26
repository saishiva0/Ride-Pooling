/**
 * Session-local ride request store (Phase 3.15 — MOBILE RIDE PARTICIPANT FLOW).
 *
 * The backend exposes request CREATION, decisions, and notifications — but NO
 * "list my ride requests" endpoint. Until such an endpoint exists, the "My
 * Requests" screen reflects what THIS session has created, tracked in memory.
 *
 * This is a deliberate, documented limitation (never an invented endpoint):
 * the store is in-memory only, resets on app restart, and is NOT authoritative
 * — the backend remains the source of truth for request state. The store is
 * framework-free (plain subscribe/notify) so it is trivially testable and can
 * be swapped for a server-backed list when the API exists.
 */
import type { RideRequestStatusValue } from './api.types';
import type { RideSummary } from './types';

/** A request recorded by the current session. */
export interface StoredRequest {
  /** The backend request id. */
  id: string;
  rideId: string;
  /** A snapshot of the ride as shown when the request was created. */
  ride: RideSummary;
  requestedSeats: number;
  status: RideRequestStatusValue;
  createdAt: Date;
}

export interface RequestStore {
  /** Records a newly created request (backend response). */
  add(request: StoredRequest): void;
  /** Overwrites the last-known status of a stored request. */
  updateStatus(requestId: string, status: RideRequestStatusValue): void;
  /** Returns the stored requests, oldest first. */
  list(): readonly StoredRequest[];
  /** Subscribes to store changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** Creates an empty, in-memory request store. */
export function createRequestStore(): RequestStore {
  let requests: StoredRequest[] = [];
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    add(request) {
      requests = [...requests, request];
      notify();
    },
    updateStatus(requestId, status) {
      requests = requests.map((request) =>
        request.id === requestId ? { ...request, status } : request,
      );
      notify();
    },
    list() {
      return requests;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
