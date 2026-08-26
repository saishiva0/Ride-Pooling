/**
 * Unit tests for the Phase 3.8 event → notification mapping layer.
 *
 * Pure, deterministic, no database: verifies WHO receives WHAT for each wired
 * Ride Engine event, the dedupe helper, and that draft persistence fans out
 * every draft through the caller's createNotification capability in order.
 */
import { describe, expect, it, vi } from 'vitest';
import { NotificationType } from '@prisma/client';
import {
  dedupe,
  newRideRequestDrafts,
  persistNotificationDrafts,
  requestAcceptedDrafts,
  requestCancelledDrafts,
  requestRejectedDrafts,
  rideCancelledDrafts,
  rideConfirmedDrafts,
  rideExpiredDrafts,
  type NotificationDraft,
} from './notification-mapping.js';
import type { NotificationCreationParams } from '../infrastructure/notification.repository.js';

const RIDE_ID = 'ride-1';
const REQUEST_ID = 'req-1';

describe('newRideRequestDrafts', () => {
  it('notifies only the ride creator with RIDE_REQUESTED', () => {
    const drafts = newRideRequestDrafts({
      rideId: RIDE_ID,
      requestId: REQUEST_ID,
      creatorId: 'creator-1',
      requesterName: 'Riya',
    });

    expect(drafts).toEqual([
      {
        recipientId: 'creator-1',
        type: NotificationType.RIDE_REQUESTED,
        rideId: RIDE_ID,
        requestId: REQUEST_ID,
        title: 'New ride request',
        body: 'Riya requested to join your ride',
      },
    ]);
  });
});

describe('requestAcceptedDrafts', () => {
  it('notifies only the requester with REQUEST_ACCEPTED', () => {
    const drafts = requestAcceptedDrafts({
      rideId: RIDE_ID,
      requestId: REQUEST_ID,
      requesterId: 'requester-1',
    });

    expect(drafts).toEqual([
      {
        recipientId: 'requester-1',
        type: NotificationType.REQUEST_ACCEPTED,
        rideId: RIDE_ID,
        requestId: REQUEST_ID,
        title: 'Ride request accepted',
        body: 'Your ride request was accepted',
      },
    ]);
  });
});

describe('requestRejectedDrafts', () => {
  it('notifies only the requester with REQUEST_REJECTED', () => {
    const drafts = requestRejectedDrafts({
      rideId: RIDE_ID,
      requestId: REQUEST_ID,
      requesterId: 'requester-1',
    });

    expect(drafts).toEqual([
      {
        recipientId: 'requester-1',
        type: NotificationType.REQUEST_REJECTED,
        rideId: RIDE_ID,
        requestId: REQUEST_ID,
        title: 'Ride request rejected',
        body: 'Your ride request was declined',
      },
    ]);
  });
});

describe('requestCancelledDrafts', () => {
  it('notifies only the ride creator with REQUEST_CANCELLED', () => {
    const drafts = requestCancelledDrafts({
      rideId: RIDE_ID,
      requestId: REQUEST_ID,
      creatorId: 'creator-1',
    });

    expect(drafts).toEqual([
      {
        recipientId: 'creator-1',
        type: NotificationType.REQUEST_CANCELLED,
        rideId: RIDE_ID,
        requestId: REQUEST_ID,
        title: 'Ride request cancelled',
        body: 'A participant cancelled their ride request',
      },
    ]);
  });
});

describe('confirmedAndCreator drafts (RIDE_CONFIRMED / RIDE_CANCELLED / RIDE_EXPIRED)', () => {
  const confirmedParticipantIds = ['participant-a', 'participant-b'];

  it('rideConfirmedDrafts notifies the creator and every confirmed participant', () => {
    const drafts = rideConfirmedDrafts({
      rideId: RIDE_ID,
      creatorId: 'creator-1',
      confirmedParticipantIds,
    });

    expect(drafts).toHaveLength(3);
    expect(drafts.map((d) => d.recipientId).sort()).toEqual([
      'creator-1',
      'participant-a',
      'participant-b',
    ]);
    for (const draft of drafts) {
      expect(draft).toMatchObject({
        type: NotificationType.RIDE_CONFIRMED,
        rideId: RIDE_ID,
        title: 'Ride confirmed',
        body: 'Your ride is confirmed',
      });
      expect(draft.requestId).toBeUndefined();
    }
  });

  it('rideCancelledDrafts notifies the creator and every confirmed participant', () => {
    const drafts = rideCancelledDrafts({
      rideId: RIDE_ID,
      creatorId: 'creator-1',
      confirmedParticipantIds,
    });

    expect(drafts.map((d) => d.recipientId).sort()).toEqual([
      'creator-1',
      'participant-a',
      'participant-b',
    ]);
    for (const draft of drafts) {
      expect(draft).toMatchObject({
        type: NotificationType.RIDE_CANCELLED,
        rideId: RIDE_ID,
        title: 'Ride cancelled',
      });
    }
  });

  it('rideExpiredDrafts notifies the creator and every confirmed participant', () => {
    const drafts = rideExpiredDrafts({
      rideId: RIDE_ID,
      creatorId: 'creator-1',
      confirmedParticipantIds,
    });

    expect(drafts.map((d) => d.recipientId).sort()).toEqual([
      'creator-1',
      'participant-a',
      'participant-b',
    ]);
    for (const draft of drafts) {
      expect(draft).toMatchObject({
        type: NotificationType.RIDE_EXPIRED,
        rideId: RIDE_ID,
        title: 'Ride expired',
      });
    }
  });

  it('deduplicates when the creator is also a confirmed participant', () => {
    const drafts = rideConfirmedDrafts({
      rideId: RIDE_ID,
      creatorId: 'creator-1',
      confirmedParticipantIds: ['creator-1', 'creator-1', 'participant-a'],
    });

    expect(drafts.map((d) => d.recipientId).sort()).toEqual([
      'creator-1',
      'participant-a',
    ]);
  });
});

describe('dedupe', () => {
  it('removes duplicates preserving first-seen order', () => {
    expect(dedupe(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for empty input', () => {
    expect(dedupe([])).toEqual([]);
  });
});

describe('persistNotificationDrafts', () => {
  it('persists every draft through the caller capability, in order', async () => {
    const createNotification = vi
      .fn()
      .mockResolvedValue({ id: 'notification-1' });
    const drafts: NotificationDraft[] = [
      {
        recipientId: 'user-1',
        type: NotificationType.RIDE_CONFIRMED,
        rideId: RIDE_ID,
        title: 'Ride confirmed',
        body: 'Your ride is confirmed',
      },
      {
        recipientId: 'user-2',
        type: NotificationType.RIDE_CONFIRMED,
        rideId: RIDE_ID,
        requestId: REQUEST_ID,
        title: 'Ride confirmed',
        body: 'Your ride is confirmed',
      },
    ];

    await persistNotificationDrafts(createNotification, drafts);

    expect(createNotification).toHaveBeenCalledTimes(2);
    const calls = vi
      .mocked(createNotification)
      .mock.calls.map((call) => call[0] as NotificationCreationParams);
    expect(calls[0]).toEqual({
      userId: 'user-1',
      type: NotificationType.RIDE_CONFIRMED,
      title: 'Ride confirmed',
      body: 'Your ride is confirmed',
      rideId: RIDE_ID,
      // Absent optional context is passed through as undefined; the
      // repository normalizes it to NULL on insert.
      requestId: undefined,
    });
    expect(calls[1]).toEqual({
      userId: 'user-2',
      type: NotificationType.RIDE_CONFIRMED,
      title: 'Ride confirmed',
      body: 'Your ride is confirmed',
      rideId: RIDE_ID,
      requestId: REQUEST_ID,
    });
  });

  it('persists nothing for an empty draft list', async () => {
    const createNotification = vi.fn();
    await persistNotificationDrafts(createNotification, []);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('propagates a persistence failure immediately (transaction rollback)', async () => {
    const createNotification = vi
      .fn()
      .mockResolvedValueOnce({ id: 'ok' })
      .mockRejectedValueOnce(new Error('boom'));
    const drafts: NotificationDraft[] = [
      {
        recipientId: 'user-1',
        type: NotificationType.RIDE_CONFIRMED,
        rideId: RIDE_ID,
        title: 't',
        body: 'b',
      },
      {
        recipientId: 'user-2',
        type: NotificationType.RIDE_CONFIRMED,
        rideId: RIDE_ID,
        title: 't',
        body: 'b',
      },
    ];

    await expect(
      persistNotificationDrafts(createNotification, drafts),
    ).rejects.toThrow('boom');
    expect(createNotification).toHaveBeenCalledTimes(2);
  });
});
