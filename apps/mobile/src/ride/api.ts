/**
 * Typed ride/notification API service (Phase 3.15 — MOBILE RIDE PARTICIPANT
 * FLOW).
 *
 * The single typed seam between screens and the generic API client
 * (`src/api/client.ts`). Every method maps to exactly one existing backend
 * endpoint (Phase 3.10) — nothing new is invented, and any capability the
 * backend does not expose (e.g. listing a user's requests, or fetching a ride
 * by id) is deliberately absent and documented instead.
 *
 * Identity: no method accepts a `userId`/`actorId`. Authentication headers are
 * attached by the API client's `AuthHeadersProvider` (Phase 3.14) and the
 * backend derives identity from them — the mobile layer never supplies it.
 *
 * Dates: `Date` values are serialized to ISO-8601 strings for the backend;
 * returned wire payloads are mapped to mobile models with native `Date`
 * objects.
 */
import type { ApiClient } from '../api/client';
import type {
  AcceptedRideRequestDto,
  CancelledRideDto,
  CancelledRideRequestDto,
  CompletedRideDto,
  CreatedRideDto,
  CreatedRideRequestDto,
  CreatorRideDto,
  DiscoveredRideDto,
  MarkAllReadResultDto,
  MatchedRideDto,
  NotificationDto,
  NotificationListResultDto,
  PublishedRideDto,
  RejectedRideRequestDto,
  StartedRideDto,
} from './api.types';
import {
  mapAcceptedRideRequest,
  mapCancelledRide,
  mapCancelledRideRequest,
  mapCompletedRide,
  mapCreatedRide,
  mapCreatorRide,
  mapDiscoveredRide,
  mapMatchedRide,
  mapNotification,
  mapNotificationList,
  mapPublishedRide,
  mapRejectedRideRequest,
  mapRideRequest,
  mapStartedRide,
} from './mappers';
import type {
  AcceptedRideRequest,
  CancelledRide,
  CancelledRideRequest,
  CompletedRide,
  CreatedRide,
  CreatorRide,
  MatchRidesInput,
  MatchedRide,
  PublishedRide,
  RejectedRideRequest,
  RideCreationInput,
  RideNotification,
  RideNotificationList,
  RideRequest,
  RideSummary,
  StartedRide,
} from './types';

/** Query values for GET endpoints; `undefined` entries are omitted. */
export type QueryValues = Record<string, string | number | undefined>;

/** Builds a deterministic query string (no leading `?`). */
export function buildQuery(values: QueryValues): string {
  const parts = Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );
  return parts.join('&');
}

export interface DiscoverRidesInput {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  limit?: number;
}

/** Input for marking a single notification read. */
export interface MarkNotificationReadInput {
  notificationId: string;
}

export interface RideApi {
  /** GET /api/v1/rides/discover — candidate rides near a pickup point. */
  discoverRides(input: DiscoverRidesInput): Promise<RideSummary[]>;

  /**
   * POST /api/v1/rides/match — deterministic matching (OD-004 resolved
   * Phase 3.19). Thresholds and the 20-result cap are server-controlled
   * product policy; the client only supplies the participant's journey
   * intent (pickup, destination, departure time, optional seats).
   */
  matchRides(input: MatchRidesInput): Promise<MatchedRide[]>;

  /** POST /api/v1/rides — the authenticated user creates a ride. */
  createRide(input: RideCreationInput): Promise<CreatedRide>;

  /** GET /api/v1/rides/mine — the authenticated creator's rides. */
  listMyRides(): Promise<CreatorRide[]>;

  /** GET /api/v1/rides/:rideId — creator's ride detail. */
  getRideDetail(rideId: string): Promise<CreatorRide>;

  /** POST /api/v1/rides/:rideId/requests — the user requests seats. */
  requestSeats(input: {
    rideId: string;
    requestedSeats?: number;
  }): Promise<RideRequest>;

  /** POST /api/v1/rides/:rideId/requests/:requestId/accept — creator only. */
  acceptRequest(input: {
    rideId: string;
    requestId: string;
  }): Promise<AcceptedRideRequest>;

  /** POST /api/v1/rides/:rideId/requests/:requestId/reject — creator only. */
  rejectRequest(input: {
    rideId: string;
    requestId: string;
  }): Promise<RejectedRideRequest>;

  /**
   * POST /api/v1/rides/:rideId/requests/:requestId/cancel — the requester
   * only. Handles both a PENDING withdrawal and an ACCEPTED participation
   * cancellation (with seat release and the last-participant CONFIRMED →
   * PUBLISHED revert).
   */
  cancelRequest(input: {
    rideId: string;
    requestId: string;
  }): Promise<CancelledRideRequest>;

  /** POST /api/v1/rides/:rideId/cancel — creator only. */
  cancelRide(input: { rideId: string }): Promise<CancelledRide>;

  /** POST /api/v1/rides/:rideId/publish — creator only, DRAFT → PUBLISHED. */
  publishRide(input: { rideId: string }): Promise<PublishedRide>;

  /** POST /api/v1/rides/:rideId/start — creator only, PUBLISHED|CONFIRMED → IN_PROGRESS. */
  startRide(input: { rideId: string }): Promise<StartedRide>;

  /** POST /api/v1/rides/:rideId/complete — creator only, IN_PROGRESS → COMPLETED. */
  completeRide(input: { rideId: string }): Promise<CompletedRide>;

  /** GET /api/v1/notifications — the authenticated user's notifications. */
  listNotifications(limit?: number): Promise<RideNotificationList>;

  /** PATCH /api/v1/notifications/:notificationId/read — owner only. */
  markNotificationRead(
    input: MarkNotificationReadInput,
  ): Promise<RideNotification>;

  /** PATCH /api/v1/notifications/read-all — the user's unread notifications. */
  markAllNotificationsRead(): Promise<{ updatedCount: number }>;
}

const RIDES_PATH = '/rides';
const DISCOVER_PATH = `${RIDES_PATH}/discover`;
const MATCH_PATH = `${RIDES_PATH}/match`;
const NOTIFICATIONS_PATH = '/notifications';
const NOTIFICATIONS_READ_ALL_PATH = `${NOTIFICATIONS_PATH}/read-all`;

function requestsPath(rideId: string): string {
  return `${RIDES_PATH}/${encodeURIComponent(rideId)}/requests`;
}

function requestDecisionPath(
  rideId: string,
  requestId: string,
  decision: 'accept' | 'reject' | 'cancel',
): string {
  return `${requestsPath(rideId)}/${encodeURIComponent(requestId)}/${decision}`;
}

function cancelPath(rideId: string): string {
  return `${RIDES_PATH}/${encodeURIComponent(rideId)}/cancel`;
}

function publishPath(rideId: string): string {
  return `${RIDES_PATH}/${encodeURIComponent(rideId)}/publish`;
}

function startPath(rideId: string): string {
  return `${RIDES_PATH}/${encodeURIComponent(rideId)}/start`;
}

function completePath(rideId: string): string {
  return `${RIDES_PATH}/${encodeURIComponent(rideId)}/complete`;
}

function myRidesPath(): string {
  return `${RIDES_PATH}/mine`;
}

function rideDetailPath(rideId: string): string {
  return `${RIDES_PATH}/${encodeURIComponent(rideId)}`;
}

function notificationReadPath(notificationId: string): string {
  return `${NOTIFICATIONS_PATH}/${encodeURIComponent(notificationId)}/read`;
}

function toIso(value: Date): string {
  return value.toISOString();
}

/** Builds the typed ride API over the generic client. */
export function createRideApi(client: ApiClient): RideApi {
  return {
    async discoverRides(input) {
      const query = buildQuery({
        latitude: input.latitude,
        longitude: input.longitude,
        radiusMeters: input.radiusMeters,
        limit: input.limit,
      });
      const rides = await client.request<DiscoveredRideDto[]>(
        `${DISCOVER_PATH}${query ? `?${query}` : ''}`,
      );
      return rides.map(mapDiscoveredRide);
    },

    async matchRides(input) {
      const matches = await client.request<MatchedRideDto[]>(MATCH_PATH, {
        method: 'POST',
        body: {
          discovery: {
            latitude: input.discovery.latitude,
            longitude: input.discovery.longitude,
          },
          destination: {
            latitude: input.destination.latitude,
            longitude: input.destination.longitude,
          },
          preferredDepartureTime: toIso(input.preferredDepartureTime),
          requestedSeats: input.requestedSeats,
        },
      });
      return matches.map(mapMatchedRide);
    },

    async createRide(input) {
      const ride = await client.request<CreatedRideDto>(RIDES_PATH, {
        method: 'POST',
        body: {
          pickup: {
            latitude: input.pickup.latitude,
            longitude: input.pickup.longitude,
            label: input.pickup.label,
          },
          destination: {
            latitude: input.destination.latitude,
            longitude: input.destination.longitude,
            label: input.destination.label,
          },
          departureDateTime: toIso(input.departureDateTime),
          totalSeats: input.totalSeats,
          vehicleType: input.vehicleType,
          discoveryRadiusKm: input.discoveryRadiusKm,
          pricingType: input.pricingType,
          pricePerKm: input.pricePerKm,
          estimatedDistanceKm: input.estimatedDistanceKm,
          estimatedContribution: input.estimatedContribution,
        },
      });
      return mapCreatedRide(ride);
    },

    async requestSeats(input) {
      const request = await client.request<CreatedRideRequestDto>(
        requestsPath(input.rideId),
        {
          method: 'POST',
          body: { requestedSeats: input.requestedSeats },
        },
      );
      return mapRideRequest(request);
    },

    async acceptRequest(input) {
      const result = await client.request<AcceptedRideRequestDto>(
        requestDecisionPath(input.rideId, input.requestId, 'accept'),
        { method: 'POST' },
      );
      return mapAcceptedRideRequest(result);
    },

    async rejectRequest(input) {
      const result = await client.request<RejectedRideRequestDto>(
        requestDecisionPath(input.rideId, input.requestId, 'reject'),
        { method: 'POST' },
      );
      return mapRejectedRideRequest(result);
    },

    async cancelRequest(input) {
      const result = await client.request<CancelledRideRequestDto>(
        requestDecisionPath(input.rideId, input.requestId, 'cancel'),
        { method: 'POST' },
      );
      return mapCancelledRideRequest(result);
    },

    async cancelRide(input) {
      const result = await client.request<CancelledRideDto>(
        cancelPath(input.rideId),
        { method: 'POST' },
      );
      return mapCancelledRide(result);
    },

    async listMyRides() {
      const rides = await client.request<CreatorRideDto[]>(myRidesPath());
      return rides.map(mapCreatorRide);
    },

    async getRideDetail(rideId) {
      const ride = await client.request<CreatorRideDto>(rideDetailPath(rideId));
      return mapCreatorRide(ride);
    },

    async publishRide(input) {
      const result = await client.request<PublishedRideDto>(
        publishPath(input.rideId),
        { method: 'POST' },
      );
      return mapPublishedRide(result);
    },

    async startRide(input) {
      const result = await client.request<StartedRideDto>(
        startPath(input.rideId),
        { method: 'POST' },
      );
      return mapStartedRide(result);
    },

    async completeRide(input) {
      const result = await client.request<CompletedRideDto>(
        completePath(input.rideId),
        { method: 'POST' },
      );
      return mapCompletedRide(result);
    },

    async listNotifications(limit) {
      const query = buildQuery({ limit });
      const result = await client.request<NotificationListResultDto>(
        `${NOTIFICATIONS_PATH}${query ? `?${query}` : ''}`,
      );
      return mapNotificationList(result);
    },

    async markNotificationRead(input) {
      const result = await client.request<NotificationDto>(
        notificationReadPath(input.notificationId),
        { method: 'PATCH' },
      );
      return mapNotification(result);
    },

    async markAllNotificationsRead() {
      const result = await client.request<MarkAllReadResultDto>(
        NOTIFICATIONS_READ_ALL_PATH,
        { method: 'PATCH' },
      );
      return { updatedCount: result.updatedCount };
    },
  };
}
