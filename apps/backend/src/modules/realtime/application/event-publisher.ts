/**
 * EventPublisher abstraction (Phase 3.11).
 *
 * The application layer depends ONLY on this interface — it never sees
 * Socket.io. Implementations:
 *
 * - `createSocketEventPublisher(io, logger)` (infrastructure) — production:
 *   emits into private user rooms.
 * - `noopEventPublisher` — the default: nothing is published until a socket
 *   server activates the real publisher.
 *
 * Registry: the Socket.io server activates the real publisher on init
 * (`setEventPublisher`). Ride Engine use cases publish through
 * `publishDrafts` (their default dependency wiring), so no controller or
 * application-service rewrite is needed. A failed or rolled-back transaction
 * never reaches the publish step (the use case awaits the transaction first).
 */
import type { NotificationDraft } from '../../notification/application/notification-mapping.js';
import { toRealtimeEvents } from './event-mapping.js';
import type { RealtimeEvent } from '../domain/realtime-events.js';

/** Framework-independent realtime publishing capability. */
export interface EventPublisher {
  publish(events: readonly RealtimeEvent[]): Promise<void>;
}

/** Default: publishes nothing. Safe until a socket server activates. */
export const noopEventPublisher: EventPublisher = {
  publish: async () => {},
};

let activePublisher: EventPublisher = noopEventPublisher;

/** Activates the real publisher (called by the Socket.io server on init). */
export function setEventPublisher(publisher: EventPublisher): void {
  activePublisher = publisher;
}

/** Restores the no-op publisher (test teardown). */
export function resetEventPublisher(): void {
  activePublisher = noopEventPublisher;
}

/** Returns the currently active publisher (defaults to no-op). */
export function getEventPublisher(): EventPublisher {
  return activePublisher;
}

/**
 * Publishes realtime events derived from notification drafts. This is the
 * default post-transaction wiring used by the Ride Engine use cases — it must
 * only ever be invoked AFTER the database transaction has committed.
 */
export function publishDrafts(
  drafts: readonly NotificationDraft[],
): Promise<void> {
  return activePublisher.publish(toRealtimeEvents(drafts));
}
