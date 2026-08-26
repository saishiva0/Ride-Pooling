/**
 * Realtime event contract (Phase 3.11).
 *
 * Framework-independent: no Socket.io types here — this is the domain shape
 * any realtime transport (Socket.io today) delivers. Only events already
 * produced by the Ride Engine/notification module are supported; no product
 * events are invented (`docs/architecture/event-model.md` §2.1).
 *
 * Payloads are minimal by contract: identifiers + a small non-sensitive
 * `data` object. Never complete database records, credentials, or private
 * location data.
 */

/** The seven realtime events, matching the Phase 3.8/3.21 notification types. */
export const REALTIME_EVENT_TYPES = [
  'RIDE_REQUESTED',
  'REQUEST_ACCEPTED',
  'REQUEST_REJECTED',
  'REQUEST_CANCELLED',
  'RIDE_CANCELLED',
  'RIDE_EXPIRED',
  'RIDE_CONFIRMED',
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

/**
 * A realtime ride event delivered to one recipient.
 *
 * - `eventId` — unique per emitted event (client-side identification only;
 *   not persisted).
 * - `occurredAt` — ISO-8601 UTC timestamp.
 * - `recipientUserId` — the ONLY recipient (the transport routes to this
 *   user's private room; server-determined, never client-controlled).
 * - `data` — minimal payload (currently the same title/body the Phase 3.8
 *   notification carries; nothing sensitive or internal).
 */
export interface RealtimeEvent {
  eventId: string;
  type: RealtimeEventType;
  occurredAt: string;
  rideId: string | null;
  requestId: string | null;
  recipientUserId: string;
  data: Record<string, unknown>;
}

/** True when `value` is one of the supported realtime event types. */
export function isRealtimeEventType(value: string): value is RealtimeEventType {
  return (REALTIME_EVENT_TYPES as readonly string[]).includes(value);
}
