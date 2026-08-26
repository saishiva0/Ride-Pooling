/**
 * Event → notification mapping layer (Phase 3.8).
 *
 * Translates successful Ride Engine operations into notification drafts. This
 * layer is the only place that knows WHO receives WHAT for a ride event; it
 * contains NO Ride Engine business rules (states, seats, locking all stay in
 * the Ride Engine). Each builder takes only the identifiers already proven
 * valid by the successful operation, so a notification is emitted only for an
 * operation that actually succeeded.
 *
 * The Ride Engine application services call `persistNotificationDrafts` with
 * their own persistence port inside the SAME transaction as the state change,
 * so a notification commit/rollback is atomic with the operation that produced
 * it (Phase 3.8 §10).
 */
import { NotificationType } from '@prisma/client';
import { notificationContent } from './notification-content.js';
import type { NotificationCreationParams } from '../infrastructure/notification.repository.js';

/** A fully-shaped notification ready to be persisted. */
export interface NotificationDraft {
  /** The user who should receive the notification. */
  recipientId: string;
  type: NotificationType;
  /** The ride context. Always present — every mapped event is ride-scoped. */
  rideId: string;
  /** The request context where the event originated (request events). */
  requestId?: string;
  title: string;
  body: string;
}

interface RideScoped {
  rideId: string;
}

/** `RIDE_REQUESTED` → the ride creator (a participant requested to join). */
export function newRideRequestDrafts(input: {
  rideId: string;
  requestId: string;
  creatorId: string;
  requesterName: string;
}): NotificationDraft[] {
  const content = notificationContent(NotificationType.RIDE_REQUESTED, {
    requesterName: input.requesterName,
  });
  return [
    {
      recipientId: input.creatorId,
      type: NotificationType.RIDE_REQUESTED,
      rideId: input.rideId,
      requestId: input.requestId,
      title: content.title,
      body: content.body,
    },
  ];
}

/** `REQUEST_ACCEPTED` → the requester (their request was accepted). */
export function requestAcceptedDrafts(
  input: RideScoped & {
    requestId: string;
    requesterId: string;
  },
): NotificationDraft[] {
  const content = notificationContent(NotificationType.REQUEST_ACCEPTED);
  return [
    {
      recipientId: input.requesterId,
      type: NotificationType.REQUEST_ACCEPTED,
      rideId: input.rideId,
      requestId: input.requestId,
      title: content.title,
      body: content.body,
    },
  ];
}

/** `REQUEST_REJECTED` → the requester (their request was declined). */
export function requestRejectedDrafts(
  input: RideScoped & {
    requestId: string;
    requesterId: string;
  },
): NotificationDraft[] {
  const content = notificationContent(NotificationType.REQUEST_REJECTED);
  return [
    {
      recipientId: input.requesterId,
      type: NotificationType.REQUEST_REJECTED,
      rideId: input.rideId,
      requestId: input.requestId,
      title: content.title,
      body: content.body,
    },
  ];
}

/**
 * `REQUEST_CANCELLED` → the ride creator (a participant withdrew their request
 * or cancelled their participation — Phase 3.21). The participant already
 * knows what they did, so only the creator is notified.
 */
export function requestCancelledDrafts(
  input: RideScoped & {
    requestId: string;
    creatorId: string;
  },
): NotificationDraft[] {
  const content = notificationContent(NotificationType.REQUEST_CANCELLED);
  return [
    {
      recipientId: input.creatorId,
      type: NotificationType.REQUEST_CANCELLED,
      rideId: input.rideId,
      requestId: input.requestId,
      title: content.title,
      body: content.body,
    },
  ];
}

/**
 * `RIDE_CONFIRMED` → the ride creator + confirmed participants (first request
 * accepted, PUBLISHED → CONFIRMED — `ride-lifecycle.md` §2.3). The creator is
 * always notified; each confirmed participant id is included with duplicates
 * removed.
 */
export function rideConfirmedDrafts(
  input: RideScoped & {
    creatorId: string;
    confirmedParticipantIds: string[];
  },
): NotificationDraft[] {
  const content = notificationContent(NotificationType.RIDE_CONFIRMED);
  return confirmedAndCreatorDrafts(input, NotificationType.RIDE_CONFIRMED, {
    title: content.title,
    body: content.body,
  });
}

/** `RIDE_CANCELLED` → the ride creator + confirmed participants. */
export function rideCancelledDrafts(
  input: RideScoped & {
    creatorId: string;
    confirmedParticipantIds: string[];
  },
): NotificationDraft[] {
  const content = notificationContent(NotificationType.RIDE_CANCELLED);
  return confirmedAndCreatorDrafts(input, NotificationType.RIDE_CANCELLED, {
    title: content.title,
    body: content.body,
  });
}

/** `RIDE_EXPIRED` → the ride creator + confirmed participants. */
export function rideExpiredDrafts(
  input: RideScoped & {
    creatorId: string;
    confirmedParticipantIds: string[];
  },
): NotificationDraft[] {
  const content = notificationContent(NotificationType.RIDE_EXPIRED);
  return confirmedAndCreatorDrafts(input, NotificationType.RIDE_EXPIRED, {
    title: content.title,
    body: content.body,
  });
}

function confirmedAndCreatorDrafts(
  input: {
    rideId: string;
    creatorId: string;
    confirmedParticipantIds: string[];
  },
  type: NotificationType,
  content: { title: string; body: string },
): NotificationDraft[] {
  const recipients = dedupe([
    input.creatorId,
    ...input.confirmedParticipantIds,
  ]);
  return recipients.map((recipientId) => ({
    recipientId,
    type,
    rideId: input.rideId,
    title: content.title,
    body: content.body,
  }));
}

/** Deduplicates ids preserving first-seen order. */
export function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Persists a list of drafts through the caller's `createNotification`
 * capability. Called from inside Ride Engine transactions (and the standalone
 * create service), so every draft commits or rolls back with the caller.
 */
export async function persistNotificationDrafts(
  createNotification: (
    params: NotificationCreationParams,
  ) => Promise<{ id: string }>,
  drafts: NotificationDraft[],
): Promise<void> {
  for (const draft of drafts) {
    await createNotification({
      userId: draft.recipientId,
      type: draft.type,
      title: draft.title,
      body: draft.body,
      rideId: draft.rideId,
      requestId: draft.requestId,
    });
  }
}
