/**
 * Shared notification types (Phase 3.23).
 *
 * Mirrors the backend Prisma NotificationType enum for type-safe
 * mobile navigation and push notification handling.
 */
export enum NotificationType {
  RIDE_CREATED = 'RIDE_CREATED',
  RIDE_PUBLISHED = 'RIDE_PUBLISHED',
  RIDE_UPDATED = 'RIDE_UPDATED',
  RIDE_REQUESTED = 'RIDE_REQUESTED',
  REQUEST_ACCEPTED = 'REQUEST_ACCEPTED',
  REQUEST_REJECTED = 'REQUEST_REJECTED',
  REQUEST_CANCELLED = 'REQUEST_CANCELLED',
  RIDE_CONFIRMED = 'RIDE_CONFIRMED',
  RIDE_STARTED = 'RIDE_STARTED',
  RIDE_CANCELLED = 'RIDE_CANCELLED',
  RIDE_COMPLETED = 'RIDE_COMPLETED',
  RIDE_EXPIRED = 'RIDE_EXPIRED',
}
