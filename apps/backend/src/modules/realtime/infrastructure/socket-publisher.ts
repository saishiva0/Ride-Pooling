/**
 * Socket.io event publisher (Phase 3.11).
 *
 * The production `EventPublisher` implementation: routes each event to the
 * recipient's private room (`user:{userId}`) under the event type as the
 * socket event name.
 *
 * Delivery is best-effort by design: a socket/delivery failure must NEVER
 * fail the already-committed database operation, so emission errors are
 * caught and logged (the persistent notification remains authoritative).
 */
import type { Server } from 'socket.io';
import type { Logger } from '../../../lib/logger.js';
import type { RealtimeEvent } from '../domain/realtime-events.js';
import type { EventPublisher } from '../application/event-publisher.js';
import { userRoom } from './rooms.js';

/** Builds the Socket.io-backed publisher for an initialized server. */
export function createSocketEventPublisher(
  io: Server,
  logger: Logger,
): EventPublisher {
  return {
    publish(events: readonly RealtimeEvent[]): Promise<void> {
      for (const event of events) {
        try {
          io.to(userRoom(event.recipientUserId)).emit(event.type, event);
        } catch (err) {
          // Never fail the committed operation because delivery failed.
          logger.warn(
            {
              err,
              eventType: event.type,
              recipientUserId: event.recipientUserId,
              eventId: event.eventId,
            },
            'Realtime event delivery failed',
          );
        }
      }
      return Promise.resolve();
    },
  };
}
