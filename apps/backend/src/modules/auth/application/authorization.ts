/**
 * Reusable authorization boundary (Phase 3.9).
 *
 * These guards are the application-boundary enforcement of the ownership rules
 * already present in the Ride Engine and notification modules:
 *
 * - ride creator → manage own ride, decide on requests for it, cancel it
 * - requester   → decide only on their OWN request
 * - recipient   → access only their OWN notifications
 *
 * They do NOT re-implement Ride Engine business rules (state machines, seats,
 * pricing, request lifecycles) — they only answer "may this authenticated user
 * act on this resource?". The identity MUST arrive as an `AuthenticatedUser`
 * produced by the authentication boundary, never as a raw caller-supplied id,
 * so a future API caller cannot submit `actorId=some-other-user` and have the
 * system trust it (`docs/development/phase-3-9-notes.md` §6).
 *
 * All guards fail closed: any mismatch throws `AuthorizationError` (403) with
 * a generic message. No resource content is revealed in the error.
 */
import { AuthorizationError } from '../../../lib/errors.js';
import type { AuthenticatedUser } from '../domain/identity.js';

/** True when the authenticated user IS `userId`. */
export function isSameUser(actor: AuthenticatedUser, userId: string): boolean {
  return actor.userId === userId;
}

/**
 * Ride Engine: only the ride creator may manage their own ride (decide on
 * requests, cancel, etc.). Throws `AuthorizationError` for any other actor.
 */
export function assertRideCreator(
  actor: AuthenticatedUser,
  rideCreatorId: string,
  rideId: string,
): void {
  if (!isSameUser(actor, rideCreatorId)) {
    throw new AuthorizationError('Only the ride creator can manage this ride', {
      field: 'userId',
      details: { rideId },
    });
  }
}

/**
 * Ride Engine requests: a user may only decide on their OWN request — never
 * on another user's request, and never as the ride creator acting on a
 * request they themselves made (the self-decision rule is a Ride Engine
 * business rule, enforced in the engine). Throws `AuthorizationError`.
 */
export function assertRequestOwner(
  actor: AuthenticatedUser,
  requesterId: string,
  requestId: string,
): void {
  if (!isSameUser(actor, requesterId)) {
    throw new AuthorizationError('You can only manage your own ride requests', {
      field: 'userId',
      details: { requestId },
    });
  }
}

/**
 * Notifications: a user may only access their own notifications (list, mark
 * read). Throws `AuthorizationError` for any other recipient.
 */
export function assertNotificationOwner(
  actor: AuthenticatedUser,
  recipientId: string,
  notificationId: string,
): void {
  if (!isSameUser(actor, recipientId)) {
    throw new AuthorizationError('You can only access your own notifications', {
      field: 'userId',
      details: { notificationId },
    });
  }
}
