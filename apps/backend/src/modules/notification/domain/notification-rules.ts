/**
 * Notification domain rules (Phase 3.8).
 *
 * Pure, deterministic validation for notification types. Notification types
 * must correspond only to events already supported by the Ride Engine
 * (`docs/architecture/event-model.md` §2.1) — this phase wires the six events
 * whose Ride Engine operations are implemented (request created/accepted/
 * rejected, ride cancelled/expired/confirmed). Types for events that are not
 * implemented yet (e.g. `RIDE_STARTED`) are valid enum values but NOT
 * supported for creation in this phase.
 */
import { NotificationType } from '@prisma/client';

/**
 * The notification types this phase creates — each maps to a Ride Engine
 * event whose operation is implemented:
 *
 * - `RIDE_REQUESTED`    ← participant requests to join (ride request created)
 * - `REQUEST_ACCEPTED`  ← creator accepts the request
 * - `REQUEST_REJECTED`  ← creator rejects the request
 * - `REQUEST_CANCELLED` ← the participant withdraws their request or cancels
 *                         their participation (Phase 3.21)
 * - `RIDE_CANCELLED`    ← ride cancelled by the creator
 * - `RIDE_EXPIRED`      ← ride expired (departure passed unstarted)
 * - `RIDE_CONFIRMED`    ← first request accepted (PUBLISHED → CONFIRMED)
 */
export const SUPPORTED_NOTIFICATION_TYPES: readonly NotificationType[] = [
  NotificationType.RIDE_REQUESTED,
  NotificationType.REQUEST_ACCEPTED,
  NotificationType.REQUEST_REJECTED,
  NotificationType.REQUEST_CANCELLED,
  NotificationType.RIDE_CANCELLED,
  NotificationType.RIDE_EXPIRED,
  NotificationType.RIDE_CONFIRMED,
];

/** True when `value` is any member of the `NotificationType` enum. */
export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === 'string' &&
    (Object.values(NotificationType) as string[]).includes(value)
  );
}

/** True when `type` is one of the notification types this phase wires. */
export function isSupportedNotificationType(type: NotificationType): boolean {
  return SUPPORTED_NOTIFICATION_TYPES.includes(type);
}
