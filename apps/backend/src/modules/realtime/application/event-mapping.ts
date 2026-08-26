/**
 * Draft → realtime event mapping (Phase 3.11).
 *
 * The Phase 3.8 notification mapping (`notification-mapping.ts`) is the
 * AUTHORITATIVE recipient definition for ride events — this layer derives the
 * realtime event from the SAME drafts the Ride Engine persists, so the
 * realtime recipient model can never diverge from the notification recipient
 * model (Phase 3.11 notes §4).
 *
 * Mapping rules:
 *
 * - Only supported realtime types are emitted; anything else is skipped (the
 *   six builders never produce unsupported types, but the guard keeps the
 *   contract honest).
 * - `eventId` is unique per event (injectable for deterministic tests).
 * - `occurredAt` is a single ISO-8601 UTC timestamp per batch.
 * - Payload is minimal: identifiers at the top level + `data` with the same
 *   title/body the persisted notification carries. Never DB records.
 */
import { randomUUID } from 'node:crypto';
import type { NotificationDraft } from '../../notification/application/notification-mapping.js';
import {
  isRealtimeEventType,
  type RealtimeEvent,
} from '../domain/realtime-events.js';

/** Injectable knobs so tests can assert deterministically. */
export interface EventMappingOptions {
  /** Timestamp used for every event (defaults to now). */
  now?: Date;
  /** Event id factory (defaults to `randomUUID`). */
  eventIdFactory?: () => string;
}

/** Maps persisted-notification drafts to their realtime event contracts. */
export function toRealtimeEvents(
  drafts: readonly NotificationDraft[],
  options: EventMappingOptions = {},
): RealtimeEvent[] {
  const occurredAt = (options.now ?? new Date()).toISOString();
  const nextEventId = options.eventIdFactory ?? randomUUID;

  const events: RealtimeEvent[] = [];
  for (const draft of drafts) {
    if (!isRealtimeEventType(draft.type)) {
      continue;
    }
    events.push({
      eventId: nextEventId(),
      type: draft.type,
      occurredAt,
      rideId: draft.rideId,
      requestId: draft.requestId ?? null,
      recipientUserId: draft.recipientId,
      data: { title: draft.title, body: draft.body },
    });
  }
  return events;
}
