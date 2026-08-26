/**
 * Pure wire → mobile mappers (Phase 3.15 — MOBILE RIDE PARTICIPANT FLOW).
 *
 * Every function is pure and deterministic: it takes a backend wire payload
 * (`api.types.ts`) and produces a mobile model (`types.ts`). The only
 * transformation is ISO date parsing into native `Date` objects and field
 * projection. No validation is duplicated here and no business logic is
 * invented — the backend contract is authoritative. Keeping these pure makes
 * them trivially unit-testable without network, rendering, or React.
 */
import type {
  AcceptedRideRequestDto,
  CancelledRideDto,
  CancelledRideRequestDto,
  CompletedRideDto,
  CreatedRideDto,
  CreatedRideRequestDto,
  CreatorRideDto,
  DiscoveredRideDto,
  MatchedRideDto,
  NotificationDto,
  NotificationListResultDto,
  PublishedRideDto,
  RejectedRideRequestDto,
  StartedRideDto,
} from './api.types';
import type {
  AcceptedRideRequest,
  CancelledRide,
  CancelledRideRequest,
  CompletedRide,
  CreatedRide,
  CreatorRide,
  FactorResult,
  MatchedRide,
  PublishedRide,
  RejectedRideRequest,
  RideNotification,
  RideNotificationList,
  RideRequest,
  RideSummary,
  StartedRide,
} from './types';

/** Parses an ISO-8601 wire datetime into a `Date`. */
export function parseIsoDate(value: string): Date {
  return new Date(value);
}

/** Maps a discovered ride payload to the mobile model. */
export function mapDiscoveredRide(dto: DiscoveredRideDto): RideSummary {
  return {
    id: dto.id,
    creator: { id: dto.creator.id, name: dto.creator.name },
    pickupLocation: {
      id: dto.pickupLocation.id,
      latitude: dto.pickupLocation.latitude,
      longitude: dto.pickupLocation.longitude,
      label: dto.pickupLocation.label,
    },
    destinationLocation: {
      id: dto.destinationLocation.id,
      latitude: dto.destinationLocation.latitude,
      longitude: dto.destinationLocation.longitude,
      label: dto.destinationLocation.label,
    },
    departureDateTime: parseIsoDate(dto.departureDateTime),
    totalSeats: dto.totalSeats,
    availableSeats: dto.availableSeats,
    pricingType: dto.pricingType,
    pricePerKm: dto.pricePerKm,
    distanceMeters: dto.distanceMeters,
    status: dto.status,
  };
}

/** Maps a created-ride payload to the mobile model. */
export function mapCreatedRide(dto: CreatedRideDto): CreatedRide {
  return {
    id: dto.id,
    creator: { id: dto.creator.id, name: dto.creator.name },
    pickupLocation: {
      id: dto.pickupLocation.id,
      latitude: dto.pickupLocation.latitude,
      longitude: dto.pickupLocation.longitude,
      label: dto.pickupLocation.label,
    },
    destinationLocation: {
      id: dto.destinationLocation.id,
      latitude: dto.destinationLocation.latitude,
      longitude: dto.destinationLocation.longitude,
      label: dto.destinationLocation.label,
    },
    departureDateTime: parseIsoDate(dto.departureDateTime),
    totalSeats: dto.totalSeats,
    vehicleType: dto.vehicleType,
    discoveryRadiusKm: dto.discoveryRadiusKm,
    pricingType: dto.pricingType,
    pricePerKm: dto.pricePerKm,
    estimatedDistanceKm: dto.estimatedDistanceKm,
    estimatedContribution: dto.estimatedContribution,
    status: dto.status,
    createdAt: parseIsoDate(dto.createdAt),
    updatedAt: parseIsoDate(dto.updatedAt),
  };
}

/** Maps a created ride-request payload to the mobile model. */
export function mapRideRequest(dto: CreatedRideRequestDto): RideRequest {
  return {
    id: dto.id,
    rideId: dto.rideId,
    requester: { id: dto.requester.id, name: dto.requester.name },
    requestedSeats: dto.requestedSeats,
    status: dto.status,
    createdAt: parseIsoDate(dto.createdAt),
  };
}

/** Maps an accepted-request payload to the mobile model. */
export function mapAcceptedRideRequest(
  dto: AcceptedRideRequestDto,
): AcceptedRideRequest {
  return {
    requestId: dto.requestId,
    requestStatus: dto.requestStatus,
    participantId: dto.participantId,
    participantStatus: dto.participantStatus,
    rideId: dto.rideId,
    allocatedSeats: dto.allocatedSeats,
    rideStatus: dto.rideStatus,
    rideStatusChanged: dto.rideStatusChanged,
  };
}

/** Maps a rejected-request payload to the mobile model. */
export function mapRejectedRideRequest(
  dto: RejectedRideRequestDto,
): RejectedRideRequest {
  return {
    requestId: dto.requestId,
    requestStatus: dto.requestStatus,
    rideId: dto.rideId,
  };
}

/** Maps a cancelled-request payload to the mobile model (Phase 3.21). */
export function mapCancelledRideRequest(
  dto: CancelledRideRequestDto,
): CancelledRideRequest {
  return {
    requestId: dto.requestId,
    requestStatus: dto.requestStatus,
    rideId: dto.rideId,
    participantId: dto.participantId,
    participantStatus: dto.participantStatus,
    releasedSeats: dto.releasedSeats,
    rideStatus: dto.rideStatus,
    rideStatusChanged: dto.rideStatusChanged,
    cancelledAt: parseIsoDate(dto.cancelledAt),
  };
}

/** Maps a cancelled-ride payload to the mobile model. */
export function mapCancelledRide(dto: CancelledRideDto): CancelledRide {
  return {
    rideId: dto.rideId,
    status: dto.status,
    cancelledAt: parseIsoDate(dto.cancelledAt),
  };
}

/** Maps a published-ride payload to the mobile model. */
export function mapPublishedRide(dto: PublishedRideDto): PublishedRide {
  return {
    rideId: dto.rideId,
    status: dto.status,
    publishedAt: parseIsoDate(dto.publishedAt),
  };
}

/** Maps a started-ride payload to the mobile model. */
export function mapStartedRide(dto: StartedRideDto): StartedRide {
  return {
    rideId: dto.rideId,
    status: dto.status,
    startedAt: parseIsoDate(dto.startedAt),
  };
}

/** Maps a completed-ride payload to the mobile model. */
export function mapCompletedRide(dto: CompletedRideDto): CompletedRide {
  return {
    rideId: dto.rideId,
    status: dto.status,
    completedAt: parseIsoDate(dto.completedAt),
  };
}

/** Maps a creator-ride payload (full created-ride shape + available seats). */
export function mapCreatorRide(dto: CreatorRideDto): CreatorRide {
  return {
    ...mapCreatedRide(dto),
    availableSeats: dto.availableSeats,
  };
}

/** Maps a matched-ride payload to the mobile model. */
export function mapMatchedRide(dto: MatchedRideDto): MatchedRide {
  return {
    ride: mapDiscoveredRide(dto.ride),
    eligible: dto.eligible,
    factors: dto.factors.map((factor): FactorResult => ({
      factor: factor.factor,
      eligible: factor.eligible,
      reason: factor.reason,
      value: factor.value,
      threshold: factor.threshold,
    })),
  };
}

/** Maps a notification payload to the mobile model. */
export function mapNotification(dto: NotificationDto): RideNotification {
  return {
    id: dto.id,
    type: dto.type,
    title: dto.title,
    body: dto.body,
    read: dto.read,
    readAt: dto.readAt === null ? null : parseIsoDate(dto.readAt),
    rideId: dto.rideId,
    requestId: dto.requestId,
    createdAt: parseIsoDate(dto.createdAt),
  };
}

/** Maps a notification-list payload to the mobile model. */
export function mapNotificationList(
  dto: NotificationListResultDto,
): RideNotificationList {
  return {
    notifications: dto.notifications.map(mapNotification),
    unreadCount: dto.unreadCount,
    hasMore: dto.hasMore,
  };
}
