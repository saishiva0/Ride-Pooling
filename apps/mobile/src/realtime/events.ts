/**
 * Mobile realtime event contract (Phase 3.13 — MOBILE FOUNDATION, §14).
 *
 * Mirrors the Phase 3.11 backend contract (`modules/realtime/domain/realtime-events.ts`)
 * EXACTLY: the same seven event types and the same event shape. The backend
 * module is backend-only (package boundary), so the mobile client carries a
 * structurally identical copy; a structural-compatibility test pins the seven
 * types. No product events are invented (`docs/architecture/event-model.md`
 * §2.1), and payloads stay minimal by contract — never full records,
 * credentials, or private location data.
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

/** A realtime ride event delivered to one recipient. */
export interface RealtimeEvent {
  eventId: string;
  type: RealtimeEventType;
  occurredAt: string;
  rideId: string | null;
  requestId: string | null;
  /** Server-determined recipient — never trusted from client-controlled state. */
  recipientUserId: string;
  data: Record<string, unknown>;
}

/** True when `value` is one of the supported realtime event types. */
export function isRealtimeEventType(value: string): value is RealtimeEventType {
  return (REALTIME_EVENT_TYPES as readonly string[]).includes(value);
}
