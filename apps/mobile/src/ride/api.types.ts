/**
 * Ride API wire types (Phase 3.15 — MOBILE RIDE PARTICIPANT FLOW).
 *
 * Structurally mirrors the authoritative backend HTTP payloads (`apps/backend`
 * ride and notification application services, as serialized over the wire by
 * the Phase 3.10 controllers). Dates arrive as ISO-8601 strings and are
 * parsed into `Date` objects by the pure mappers (`mappers.ts`); mobile models
 * live in `types.ts`. This layer is deliberately a faithful copy of the
 * backend contract — no business rules or invented fields.
 *
 * Backend source of truth:
 * - ride application services: `discover-rides.ts`, `create-ride.ts`,
 *   `create-ride-request.ts`, `accept-ride-request.ts`, `reject-ride-request.ts`,
 *   `cancel-ride.ts`, `match-rides.ts`, `publish-ride.ts`, `start-ride.ts`,
 *   `complete-ride.ts`, `list-creator-rides.ts`, `get-ride-detail.ts`
 * - notification application services: `notification-dependencies.ts`,
 *   `list-notifications.ts`, `mark-notification-as-read.ts`,
 *   `mark-all-notifications-as-read.ts`
 */

/** Canonical ride statuses (`@prisma/client` RideStatus). */
export type RideStatusValue =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED';

/** Canonical ride request statuses (`@prisma/client` RideRequestStatus). */
export type RideRequestStatusValue =
  'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';

/** Canonical pricing types (`docs/domain/pricing-model.md` §2). */
export type PricingTypeValue = 'STANDARD' | 'CUSTOM';

/** The seven notification types (Phase 3.8 / Phase 3.11 / Phase 3.21 contract). */
export type NotificationTypeValue =
  | 'RIDE_REQUESTED'
  | 'REQUEST_ACCEPTED'
  | 'REQUEST_REJECTED'
  | 'REQUEST_CANCELLED'
  | 'RIDE_CANCELLED'
  | 'RIDE_EXPIRED'
  | 'RIDE_CONFIRMED';

export interface RideUserDto {
  id: string;
  name: string;
}

export interface RideLocationDto {
  id: string;
  latitude: number;
  longitude: number;
  label: string | null;
}

/** `DiscoveredRide` (backend `discover-rides.ts`). */
export interface DiscoveredRideDto {
  id: string;
  creator: RideUserDto;
  pickupLocation: RideLocationDto;
  destinationLocation: RideLocationDto;
  departureDateTime: string;
  totalSeats: number;
  availableSeats: number;
  pricingType: PricingTypeValue;
  pricePerKm: number;
  /** Straight-line pickup-to-pickup distance in meters. */
  distanceMeters: number;
  status: RideStatusValue;
}

/** `CreatedRide` (backend `create-ride.ts`). */
export interface CreatedRideDto {
  id: string;
  creator: RideUserDto;
  pickupLocation: RideLocationDto;
  destinationLocation: RideLocationDto;
  departureDateTime: string;
  totalSeats: number;
  vehicleType: string | null;
  discoveryRadiusKm: number | null;
  pricingType: PricingTypeValue;
  pricePerKm: number;
  estimatedDistanceKm: number | null;
  estimatedContribution: number | null;
  status: RideStatusValue;
  createdAt: string;
  updatedAt: string;
}

/** `CreatedRideRequest` (backend `create-ride-request.ts`). */
export interface CreatedRideRequestDto {
  id: string;
  rideId: string;
  requester: RideUserDto;
  requestedSeats: number;
  status: RideRequestStatusValue;
  createdAt: string;
}

/** `AcceptedRideRequest` (backend `accept-ride-request.ts`). */
export interface AcceptedRideRequestDto {
  requestId: string;
  requestStatus: RideRequestStatusValue;
  participantId: string;
  participantStatus: string;
  rideId: string;
  allocatedSeats: number;
  rideStatus: RideStatusValue;
  rideStatusChanged: boolean;
}

/** `RejectedRideRequest` (backend `reject-ride-request.ts`). */
export interface RejectedRideRequestDto {
  requestId: string;
  requestStatus: RideRequestStatusValue;
  rideId: string;
}

/** `CancelledRideRequest` (backend `cancel-ride-request.ts`). */
export interface CancelledRideRequestDto {
  requestId: string;
  requestStatus: RideRequestStatusValue;
  rideId: string;
  /** Present only when an ACCEPTED participation was cancelled. */
  participantId: string | null;
  participantStatus: string | null;
  /** Seats freed by the cancellation (0 for a PENDING withdrawal). */
  releasedSeats: number;
  rideStatus: RideStatusValue;
  rideStatusChanged: boolean;
  cancelledAt: string;
}

/** `CancelledRide` (backend `cancel-ride.ts`). */
export interface CancelledRideDto {
  rideId: string;
  status: RideStatusValue;
  cancelledAt: string;
}

/** `PublishedRide` (backend `publish-ride.ts`). */
export interface PublishedRideDto {
  rideId: string;
  status: RideStatusValue;
  publishedAt: string;
}

/** `StartedRide` (backend `start-ride.ts`). */
export interface StartedRideDto {
  rideId: string;
  status: RideStatusValue;
  startedAt: string;
}

/** `CompletedRide` (backend `complete-ride.ts`). */
export interface CompletedRideDto {
  rideId: string;
  status: RideStatusValue;
  completedAt: string;
}

/** `CreatorRide` (backend `creator-ride-read.ts`): the creator's own ride with
 * live seat availability (GET /rides/mine, GET /rides/:rideId). */
export interface CreatorRideDto extends CreatedRideDto {
  /** totalSeats − CONFIRMED participants' allocated seats (never negative). */
  availableSeats: number;
}

/** `FactorResult` (backend `domain/matching/types.ts`). */
export interface FactorResultDto {
  factor: string;
  eligible: boolean;
  reason: string;
  value?: number | string;
  threshold?: number;
}

/** `MatchedRide` (backend `match-rides.ts`). */
export interface MatchedRideDto {
  ride: DiscoveredRideDto;
  eligible: boolean;
  factors: FactorResultDto[];
}

/** `AppNotification` (backend `notification-dependencies.ts`). */
export interface NotificationDto {
  id: string;
  recipientUserId: string;
  type: NotificationTypeValue;
  title: string | null;
  body: string | null;
  read: boolean;
  readAt: string | null;
  rideId: string | null;
  requestId: string | null;
  createdAt: string;
}

/** `NotificationListResult` (backend `list-notifications.ts`). */
export interface NotificationListResultDto {
  notifications: NotificationDto[];
  unreadCount: number;
  hasMore: boolean;
}

/** `MarkAllNotificationsAsReadResult` (backend mark-all service). */
export interface MarkAllReadResultDto {
  updatedCount: number;
}
