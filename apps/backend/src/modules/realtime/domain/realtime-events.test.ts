/**
 * Unit tests for the realtime event contract (Phase 3.11).
 *
 * Only the seven Ride Engine events already produced by the notification module
 * are supported; no product events are invented.
 */
import { describe, expect, it } from 'vitest';
import {
  REALTIME_EVENT_TYPES,
  isRealtimeEventType,
} from './realtime-events.js';

describe('REALTIME_EVENT_TYPES', () => {
  it('exposes exactly the seven supported ride events', () => {
    expect([...REALTIME_EVENT_TYPES].sort()).toEqual(
      [
        'RIDE_REQUESTED',
        'REQUEST_ACCEPTED',
        'REQUEST_REJECTED',
        'REQUEST_CANCELLED',
        'RIDE_CANCELLED',
        'RIDE_EXPIRED',
        'RIDE_CONFIRMED',
      ].sort(),
    );
  });
});

describe('isRealtimeEventType', () => {
  it('accepts the seven supported types', () => {
    for (const type of REALTIME_EVENT_TYPES) {
      expect(isRealtimeEventType(type)).toBe(true);
    }
  });

  it('rejects anything else (no invented product events)', () => {
    expect(isRealtimeEventType('RIDE_CREATED')).toBe(false);
    expect(isRealtimeEventType('RIDE_PUBLISHED')).toBe(false);
    expect(isRealtimeEventType('RIDE_STARTED')).toBe(false);
    expect(isRealtimeEventType('RIDE_COMPLETED')).toBe(false);
    expect(isRealtimeEventType('chat')).toBe(false);
    expect(isRealtimeEventType('')).toBe(false);
  });
});
