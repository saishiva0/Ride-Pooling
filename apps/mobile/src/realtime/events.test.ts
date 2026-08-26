import { describe, expect, it } from 'vitest';
import {
  REALTIME_EVENT_TYPES,
  isRealtimeEventType,
  type RealtimeEvent,
} from './events';

describe('REALTIME_EVENT_TYPES', () => {
  it('contains the seven ride events plus two chat events', () => {
    expect(REALTIME_EVENT_TYPES).toEqual([
      'RIDE_REQUESTED',
      'REQUEST_ACCEPTED',
      'REQUEST_REJECTED',
      'REQUEST_CANCELLED',
      'RIDE_CANCELLED',
      'RIDE_EXPIRED',
      'RIDE_CONFIRMED',
      'CHAT_MESSAGE_CREATED',
      'CHAT_READ_UPDATED',
    ]);
    expect(REALTIME_EVENT_TYPES).toHaveLength(9);
  });
  it('accepts supported types and rejects unsupported values', () => {
    for (const type of REALTIME_EVENT_TYPES)
      expect(isRealtimeEventType(type)).toBe(true);
    expect(isRealtimeEventType('RIDE_STARTED')).toBe(false);
    expect(isRealtimeEventType('')).toBe(false);
    expect(isRealtimeEventType('chat.message')).toBe(false);
  });
});

describe('RealtimeEvent shape', () => {
  it('matches the shared event shape', () => {
    const event: RealtimeEvent = {
      eventId: 'evt-1',
      type: 'RIDE_REQUESTED',
      occurredAt: '2026-08-17T12:00:00.000Z',
      rideId: 'ride-1',
      requestId: 'req-1',
      recipientUserId: 'user-2',
      data: { title: 'New ride request', body: 'A participant wants to join' },
    };
    expect(event.eventId).toBe('evt-1');
    expect(event.type).toBe('RIDE_REQUESTED');
    expect(event.recipientUserId).toBe('user-2');
    expect(event.data).toEqual({
      title: 'New ride request',
      body: 'A participant wants to join',
    });
  });
});
