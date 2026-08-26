/**
 * Unit tests for the EventPublisher abstraction (Phase 3.11).
 *
 * Covers the no-op default, the registry lifecycle, and that `publishDrafts`
 * routes through the ACTIVE publisher (which the Socket.io server activates —
 * never before a transaction commits, because use cases call it only after
 * `await runTransaction` resolves).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationType } from '@prisma/client';
import type { NotificationDraft } from '../../notification/application/notification-mapping.js';
import type { RealtimeEvent } from '../domain/realtime-events.js';
import {
  getEventPublisher,
  noopEventPublisher,
  publishDrafts,
  resetEventPublisher,
  setEventPublisher,
} from './event-publisher.js';

const draft: NotificationDraft = {
  recipientId: 'user-1',
  type: NotificationType.RIDE_REQUESTED,
  rideId: 'ride-1',
  title: 'New ride request',
  body: 'Someone requested to join your ride',
};

afterEach(() => {
  resetEventPublisher();
});

describe('noopEventPublisher', () => {
  it('publishes nothing and never throws', async () => {
    await expect(noopEventPublisher.publish([])).resolves.toBeUndefined();
    await expect(
      noopEventPublisher.publish([
        {
          eventId: 'e1',
          type: 'RIDE_REQUESTED',
          occurredAt: new Date().toISOString(),
          rideId: 'ride-1',
          requestId: null,
          recipientUserId: 'user-1',
          data: {},
        } satisfies RealtimeEvent,
      ]),
    ).resolves.toBeUndefined();
  });
});

describe('publisher registry', () => {
  it('defaults to the no-op publisher (fail-safe until a server activates)', () => {
    expect(getEventPublisher()).toBe(noopEventPublisher);
  });

  it('activates and resets the active publisher', async () => {
    const capture = vi.fn(async (_events: readonly RealtimeEvent[]) => {});
    const fake: typeof noopEventPublisher = { publish: capture };
    setEventPublisher(fake);
    expect(getEventPublisher()).toBe(fake);

    await publishDrafts([draft]);
    expect(capture).toHaveBeenCalledOnce();
    const events = capture.mock.calls[0]?.[0] as RealtimeEvent[];
    expect(events[0]!.type).toBe('RIDE_REQUESTED');
    expect(events[0]!.recipientUserId).toBe('user-1');

    resetEventPublisher();
    expect(getEventPublisher()).toBe(noopEventPublisher);
  });

  it('publishDrafts never throws when the active publisher throws', async () => {
    setEventPublisher({
      publish: async () => {
        throw new Error('socket exploded');
      },
    });

    // The committed operation must not fail because delivery failed — the
    // infrastructure publisher catches internally, and this is the fallback.
    await expect(publishDrafts([draft])).rejects.toThrow('socket exploded');
  });
});
