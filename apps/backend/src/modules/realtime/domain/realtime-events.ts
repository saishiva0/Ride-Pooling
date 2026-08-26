/** Framework-independent realtime event contract. */

export const REALTIME_EVENT_TYPES = [
  'RIDE_REQUESTED',
  'REQUEST_ACCEPTED',
  'REQUEST_REJECTED',
  'REQUEST_CANCELLED',
  'RIDE_CANCELLED',
  'RIDE_EXPIRED',
  'RIDE_CONFIRMED',
  'CHAT_MESSAGE_CREATED',
  'CHAT_READ_UPDATED',
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

export interface RealtimeEvent {
  eventId: string;
  type: RealtimeEventType;
  occurredAt: string;
  rideId: string | null;
  requestId: string | null;
  recipientUserId: string;
  data: Record<string, unknown>;
}

export function isRealtimeEventType(value: string): value is RealtimeEventType {
  return (REALTIME_EVENT_TYPES as readonly string[]).includes(value);
}
