/**
 * Session-local ride request store (Phase 3.15 — MOBILE RIDE PARTICIPANT FLOW;
 * superseded as authoritative by the V1 rider read path).
 *
 * The backend now exposes `GET /api/v1/rides/requests/mine`, and the "My
 * Requests" screen loads its state from that endpoint (`my-requests-screen.tsx`)
 * — so this in-memory store is NO LONGER the source of truth and is not wired
 * into the navigator. It remains available as an optional UI cache (plain
 * subscribe/notify, framework-free) and is retained for compatibility; it must
 * never be treated as authoritative for request state.
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
