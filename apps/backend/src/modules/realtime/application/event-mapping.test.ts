/**
 * Unit tests for the draft → realtime event mapping (Phase 3.11).
 *
 * Covers: deterministic contract shape for the same application event
 * (injectable eventId/timestamp), recipient/identifier mapping, minimal
 * payloads (no database records, no secrets), and rejection of unsupported
 * types.
 */
import { describe, expect, it } from 'vitest';
import { NotificationType } from '@prisma/client';
import type { NotificationDraft } from '../../notification/application/notification-mapping.js';
import { toRealtimeEvents } from './event-mapping.js';

const fixedNow = new Date('2026-08-17T12:00:00.000Z');
const fixedId = () => 'evt-fixed';

const requestDraft: NotificationDraft = {
  recipientId: 'creator-1',
  type: NotificationType.RIDE_REQUESTED,
  rideId: 'ride-1',
  requestId: 'request-1',
  title: 'New ride request',
  body: 'Riya requested to join your ride',
};

describe('toRealtimeEvents', () => {
  it('produces the same contract shape for the same application event', () => {
    const options = { now: fixedNow, eventIdFactory: fixedId };

    const first = toRealtimeEvents([requestDraft], options);
    const second = toRealtimeEvents([requestDraft], options);

    expect(second).toEqual(first);
    expect(first[0]).toEqual({
      eventId: 'evt-fixed',
      type: 'RIDE_REQUESTED',
      occurredAt: '2026-08-17T12:00:00.000Z',
      rideId: 'ride-1',
      requestId: 'request-1',
      recipientUserId: 'creator-1',
      data: {
        title: 'New ride request',
        body: 'Riya requested to join your ride',
      },
    });
  });

  it('uses unique event ids and a single UTC timestamp per batch by default', () => {
    const events = toRealtimeEvents(
      [
        requestDraft,
        {
          ...requestDraft,
          recipientId: 'other',
          type: NotificationType.RIDE_CONFIRMED,
        },
      ],
      { now: fixedNow },
    );

    expect(events).toHaveLength(2);
    expect(events[0]!.eventId).not.toBe(events[1]!.eventId);
    expect(events[0]!.occurredAt).toBe(events[1]!.occurredAt);
    expect(events[0]!.occurredAt.endsWith('Z')).toBe(true); // UTC ISO-8601
  });

  it('keeps the payload minimal: identifiers + small data, never records', () => {
    const event = toRealtimeEvents([requestDraft], {
      now: fixedNow,
      eventIdFactory: fixedId,
    })[0]!;

    expect(Object.keys(event).sort()).toEqual(
      [
        'data',
        'eventId',
        'occurredAt',
        'recipientUserId',
        'requestId',
        'rideId',
        'type',
      ].sort(),
    );
    // data carries only the notification content — no DB records, no
    // credentials, no coordinates, no internal fields.
    expect(event.data).toEqual({
      title: 'New ride request',
      body: 'Riya requested to join your ride',
    });
    expect(event.data).not.toHaveProperty('userId');
    expect(event.data).not.toHaveProperty('password');
    expect(JSON.stringify(event)).not.toContain('password');
  });

  it('maps ride-scoped drafts without a request context to requestId null', () => {
    const cancelled: NotificationDraft = {
      recipientId: 'creator-1',
      type: NotificationType.RIDE_CANCELLED,
      rideId: 'ride-1',
      title: 'Ride cancelled',
      body: 'A ride you joined was cancelled',
    };
    const event = toRealtimeEvents([cancelled], {
      now: fixedNow,
      eventIdFactory: fixedId,
    })[0]!;

    expect(event.rideId).toBe('ride-1');
    expect(event.requestId).toBeNull();
  });

  it('maps a REQUEST_CANCELLED draft (Phase 3.21) to a realtime event', () => {
    const cancelled: NotificationDraft = {
      recipientId: 'creator-1',
      type: NotificationType.REQUEST_CANCELLED,
      rideId: 'ride-1',
      requestId: 'request-1',
      title: 'Ride request cancelled',
      body: 'A participant cancelled their ride request',
    };
    const event = toRealtimeEvents([cancelled], {
      now: fixedNow,
      eventIdFactory: fixedId,
    })[0]!;

    expect(event.type).toBe('REQUEST_CANCELLED');
    expect(event.rideId).toBe('ride-1');
    expect(event.requestId).toBe('request-1');
    expect(event.recipientUserId).toBe('creator-1');
  });

  it('skips drafts whose type is not a supported realtime event', () => {
    const unsupported: NotificationDraft = {
      recipientId: 'x',
      type: NotificationType.RIDE_STARTED,
      rideId: 'ride-1',
      title: 'Ride started',
      body: 'started',
    };

    expect(toRealtimeEvents([unsupported])).toEqual([]);
  });
});
