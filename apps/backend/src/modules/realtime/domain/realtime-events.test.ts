import { describe, expect, it } from 'vitest';
import {
  REALTIME_EVENT_TYPES,
  isRealtimeEventType,
} from './realtime-events.js';

describe('REALTIME_EVENT_TYPES', () => {
  it('exposes the seven ride events plus the two chat events', () => {
    expect([...REALTIME_EVENT_TYPES].sort()).toEqual(
      [
        'RIDE_REQUESTED',
        'REQUEST_ACCEPTED',
        'REQUEST_REJECTED',
        'REQUEST_CANCELLED',
        'RIDE_CANCELLED',
        'RIDE_EXPIRED',
        'RIDE_CONFIRMED',
        'CHAT_MESSAGE_CREATED',
        'CHAT_READ_UPDATED',
      ].sort(),
    );
  });
});

describe('isRealtimeEventType', () => {
  it('accepts every supported type', () => {
    for (const type of REALTIME_EVENT_TYPES)
      expect(isRealtimeEventType(type)).toBe(true);
  });
  it('rejects unsupported types', () => {
    expect(isRealtimeEventType('RIDE_CREATED')).toBe(false);
    expect(isRealtimeEventType('RIDE_PUBLISHED')).toBe(false);
    expect(isRealtimeEventType('RIDE_STARTED')).toBe(false);
    expect(isRealtimeEventType('RIDE_COMPLETED')).toBe(false);
    expect(isRealtimeEventType('chat')).toBe(false);
    expect(isRealtimeEventType('')).toBe(false);
  });
});
