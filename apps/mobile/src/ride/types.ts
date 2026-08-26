/**
 * Mobile ride domain models (Phase 3.15 — MOBILE RIDE PARTICIPANT FLOW).
 *
 * The mobile-facing shapes screens consume. Dates are native `Date` objects
 * (parsed from wire ISO strings by `mappers.ts`), and no wire/HTTP concerns
 * leak into screens. Identity is deliberately absent: no `userId` is ever
 * carried by a request payload — the backend derives identity from the
 * authenticated headers supplied by the API client's `AuthHeadersProvider`
 * (Phase 3.14). Any `userId` comparison on screen is purely presentational
 * (e.g. showing creator-only actions); authorization stays server-side.
 */
import type {
  NotificationTypeValue,
  PricingTypeValue,
  RideRequestStatusValue,
  RideStatusValue,
} from './api.types';

export interface RideUser {
  id: string;
  name: string;
}

export interface RideLocation {
  id: string;
  latitude: number;
  longitude: number;
  label: string | null;
}

/** A discovered ride, as shown on the discover list and ride details. */
export interface RideSummary {
  id: string;
  creator: RideUser;
  pickupLocation: RideLocation;
  destinationLocation: RideLocation;
  departureDateTime: Date;
  totalSeats: number;
  availableSeats: number;
  pricingType: PricingTypeValue;
  pricePerKm: number;
  distanceMeters: number;
  status: RideStatusValue;
}

/** A ride created by the authenticated user (POST /api/v1/rides). */
export interface CreatedRide {
  id: string;
  creator: RideUser;
  pickupLocation: RideLocation;
  destinationLocation: RideLocation;
  departureDateTime: Date;
  totalSeats: number;
  vehicleType: string | null;
  discoveryRadiusKm: number | null;
  pricingType: PricingTypeValue;
  pricePerKm: number;
  estimatedDistanceKm: number | null;
  estimatedContribution: number | null;
  status: RideStatusValue;
  createdAt: Date;
  updatedAt: Date;
}

/** A ride request created by the authenticated user. */
export interface RideRequest {
  id: string;
  rideId: string;
  requester: RideUser;
  requestedSeats: number;
  status: RideRequestStatusValue;
  createdAt: Date;
}

/** Result of the creator accepting a request (POST .../accept). */
export interface AcceptedRideRequest {
  requestId: string;
  requestStatus: RideRequestStatusValue;
  participantId: string;
  participantStatus: string;
  rideId: string;
  allocatedSeats: number;
  rideStatus: RideStatusValue;
  rideStatusChanged: boolean;
}

/** Result of the creator rejecting a request (POST .../reject). */
export interface RejectedRideRequest {
  requestId: string;
  requestStatus: RideRequestStatusValue;
  rideId: string;
}

/** Result of the requester cancelling a request / participation
 * (POST .../cancel). `participantId`/`participantStatus`/`releasedSeats` are
 * present only when an ACCEPTED participation was cancelled. */
export interface CancelledRideRequest {
  requestId: string;
  requestStatus: RideRequestStatusValue;
  rideId: string;
  participantId: string | null;
  participantStatus: string | null;
  releasedSeats: number;
  rideStatus: RideStatusValue;
  rideStatusChanged: boolean;
  cancelledAt: Date;
}

/** Result of the creator cancelling a ride (POST .../cancel). */
export interface CancelledRide {
  rideId: string;
  status: RideStatusValue;
  cancelledAt: Date;
}

/** Result of the creator publishing a ride (POST .../publish). */
export interface PublishedRide {
  rideId: string;
  status: RideStatusValue;
  publishedAt: Date;
}

/** Result of the creator starting a ride (POST .../start). */
export interface StartedRide {
  rideId: string;
  status: RideStatusValue;
  startedAt: Date;
}

/** Result of the creator completing a ride (POST .../complete). */
export interface CompletedRide {
  rideId: string;
  status: RideStatusValue;
  completedAt: Date;
}

/** A ride as seen by its creator (GET /rides/mine, GET /rides/:rideId): the
 * full created-ride shape plus live seat availability. */
export interface CreatorRide extends CreatedRide {
  /** totalSeats − CONFIRMED participants' allocated seats (never negative). */
  availableSeats: number;
}

/** Input for the deterministic matching capability (POST /api/v1/rides/match).
 * OD-004 resolved Phase 3.19: thresholds and result cap are server-controlled
 * product policy — the client sends only the participant's journey intent.
 */
export interface MatchRidesInput {
  discovery: {
    latitude: number;
    longitude: number;
  };
  destination: { latitude: number; longitude: number };
  preferredDepartureTime: Date;
  requestedSeats?: number;
}

/** Structured, explainable factor result for a matched ride. */
export interface FactorResult {
  factor: string;
  eligible: boolean;
  reason: string;
  value?: number | string;
  threshold?: number;
}

/** A matched ride: the discovered ride plus its eligibility decision. */
export interface MatchedRide {
  ride: RideSummary;
  eligible: boolean;
  factors: FactorResult[];
}

/** Input for creating a ride (POST /api/v1/rides). */
export interface RideCreationInput {
  pickup: { latitude: number; longitude: number; label?: string };
  destination: { latitude: number; longitude: number; label?: string };
  departureDateTime: Date;
  totalSeats: number;
  vehicleType?: string;
  discoveryRadiusKm?: number;
  pricingType: PricingTypeValue;
  pricePerKm: number;
  estimatedDistanceKm?: number;
  estimatedContribution?: number;
}

/** A notification delivered to the authenticated user. */
export interface RideNotification {
  id: string;
  type: NotificationTypeValue;
  title: string | null;
  body: string | null;
  read: boolean;
  readAt: Date | null;
  rideId: string | null;
  requestId: string | null;
  createdAt: Date;
}

/** A page of notifications (backend `NotificationListResult`). */
export interface RideNotificationList {
  notifications: RideNotification[];
  unreadCount: number;
  hasMore: boolean;
}
