/**
 * Deterministic test fixtures (Phase 3.15; Phase 3.16 adds location fakes).
 *
 * Factory builders for wire DTOs and mobile models so tests stay readable and
 * avoid duplicated literal payloads. Pure, deterministic, no network.
 */
import { vi, type Mock } from 'vitest';
import type { AppNavigation } from '../src/navigation/app-navigator';
import type { GeocodingProvider } from '../src/location/geocoding';
import type { LocationClient } from '../src/location/location-client';
import type { LocationPermissionStatus } from '../src/location/permission';
import type {
  Coordinate,
  LocationReference,
  RouteRequest,
  RouteResult,
} from '../src/location/location.types';
import type { RoutingProvider } from '../src/location/routing';
import type { RideApi } from '../src/ride/api';
import type {
  AcceptedRideRequestDto,
  CancelledRideDto,
  CancelledRideRequestDto,
  CreatedRideDto,
  CreatedRideRequestDto,
  DiscoveredRideDto,
  MatchedRideDto,
  NotificationDto,
} from '../src/ride/api.types';
import type {
  AcceptedRideRequest,
  CancelledRide,
  CancelledRideRequest,
  CompletedRide,
  CreatedRide,
  CreatorRide,
  PublishedRide,
  RideNotification,
  RideRequest,
  RideSummary,
  StartedRide,
} from '../src/ride/types';
import type { SafetyApi } from '../src/safety/api';
import type {
  ActiveBlockDto,
  BlockDto,
  ReportDto,
} from '../src/safety/api.types';
import type { ActiveBlock, Block, Report } from '../src/safety/types';

export const ISO_STRING = '2026-08-18T10:05:00.000Z';

export function discoveredRideDto(
  overrides: Partial<DiscoveredRideDto> = {},
): DiscoveredRideDto {
  return {
    id: 'ride-1',
    creator: { id: 'creator-1', name: 'Ava' },
    pickupLocation: {
      id: 'loc-1',
      latitude: 12.9716,
      longitude: 77.5946,
      label: 'MG Road',
    },
    destinationLocation: {
      id: 'loc-2',
      latitude: 12.9352,
      longitude: 77.6245,
      label: 'Koramangala',
    },
    departureDateTime: ISO_STRING,
    totalSeats: 4,
    availableSeats: 3,
    pricingType: 'STANDARD',
    pricePerKm: 2.5,
    distanceMeters: 1200,
    status: 'PUBLISHED',
    ...overrides,
  };
}

export function createdRideDto(
  overrides: Partial<CreatedRideDto> = {},
): CreatedRideDto {
  return {
    id: 'ride-1',
    creator: { id: 'creator-1', name: 'Ava' },
    pickupLocation: {
      id: 'loc-1',
      latitude: 12.9716,
      longitude: 77.5946,
      label: 'MG Road',
    },
    destinationLocation: {
      id: 'loc-2',
      latitude: 12.9352,
      longitude: 77.6245,
      label: 'Koramangala',
    },
    departureDateTime: ISO_STRING,
    totalSeats: 4,
    vehicleType: 'Sedan',
    discoveryRadiusKm: 10,
    pricingType: 'STANDARD',
    pricePerKm: 2.5,
    estimatedDistanceKm: 5.2,
    estimatedContribution: 13,
    status: 'DRAFT',
    createdAt: ISO_STRING,
    updatedAt: ISO_STRING,
    ...overrides,
  };
}

export function createdRideRequestDto(
  overrides: Partial<CreatedRideRequestDto> = {},
): CreatedRideRequestDto {
  return {
    id: 'request-1',
    rideId: 'ride-1',
    requester: { id: 'user-2', name: 'Bo' },
    requestedSeats: 1,
    status: 'PENDING',
    createdAt: ISO_STRING,
    ...overrides,
  };
}

export function acceptedRideRequestDto(
  overrides: Partial<AcceptedRideRequestDto> = {},
): AcceptedRideRequestDto {
  return {
    requestId: 'request-1',
    requestStatus: 'ACCEPTED',
    participantId: 'participant-1',
    participantStatus: 'CONFIRMED',
    rideId: 'ride-1',
    allocatedSeats: 1,
    rideStatus: 'CONFIRMED',
    rideStatusChanged: true,
    ...overrides,
  };
}

export function cancelledRideDto(
  overrides: Partial<CancelledRideDto> = {},
): CancelledRideDto {
  return {
    rideId: 'ride-1',
    status: 'CANCELLED',
    cancelledAt: ISO_STRING,
    ...overrides,
  };
}

export function cancelledRideRequestDto(
  overrides: Partial<CancelledRideRequestDto> = {},
): CancelledRideRequestDto {
  return {
    requestId: 'request-1',
    requestStatus: 'CANCELLED',
    rideId: 'ride-1',
    participantId: null,
    participantStatus: null,
    releasedSeats: 0,
    rideStatus: 'PUBLISHED',
    rideStatusChanged: false,
    cancelledAt: ISO_STRING,
    ...overrides,
  };
}

export function matchedRideDto(
  overrides: Partial<MatchedRideDto> = {},
): MatchedRideDto {
  return {
    ride: discoveredRideDto(),
    eligible: true,
    factors: [
      {
        factor: 'pickupProximity',
        eligible: true,
        reason: 'Within pickup radius',
        value: 1200,
        threshold: 5000,
      },
    ],
    ...overrides,
  };
}

export function notificationDto(
  overrides: Partial<NotificationDto> = {},
): NotificationDto {
  return {
    id: 'notification-1',
    recipientUserId: 'user-1',
    type: 'RIDE_REQUESTED',
    title: 'New ride request',
    body: 'Bo requested to join your ride',
    read: false,
    readAt: null,
    rideId: 'ride-1',
    requestId: 'request-1',
    createdAt: ISO_STRING,
    ...overrides,
  };
}

export function rideSummary(overrides: Partial<RideSummary> = {}): RideSummary {
  const dto = discoveredRideDto();
  return {
    id: dto.id,
    creator: dto.creator,
    pickupLocation: dto.pickupLocation,
    destinationLocation: dto.destinationLocation,
    departureDateTime: new Date(dto.departureDateTime),
    totalSeats: dto.totalSeats,
    availableSeats: dto.availableSeats,
    pricingType: dto.pricingType,
    pricePerKm: dto.pricePerKm,
    distanceMeters: dto.distanceMeters,
    status: dto.status,
    ...overrides,
  };
}

export function createdRide(overrides: Partial<CreatedRide> = {}): CreatedRide {
  const dto = createdRideDto();
  return {
    id: dto.id,
    creator: dto.creator,
    pickupLocation: dto.pickupLocation,
    destinationLocation: dto.destinationLocation,
    departureDateTime: new Date(dto.departureDateTime),
    totalSeats: dto.totalSeats,
    vehicleType: dto.vehicleType,
    discoveryRadiusKm: dto.discoveryRadiusKm,
    pricingType: dto.pricingType,
    pricePerKm: dto.pricePerKm,
    estimatedDistanceKm: dto.estimatedDistanceKm,
    estimatedContribution: dto.estimatedContribution,
    status: dto.status,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    ...overrides,
  };
}

export function creatorRide(overrides: Partial<CreatorRide> = {}): CreatorRide {
  return {
    ...createdRide(),
    availableSeats: 3,
    ...overrides,
  };
}

export function rideRequest(overrides: Partial<RideRequest> = {}): RideRequest {
  const dto = createdRideRequestDto();
  return {
    id: dto.id,
    rideId: dto.rideId,
    requester: dto.requester,
    requestedSeats: dto.requestedSeats,
    status: dto.status,
    createdAt: new Date(dto.createdAt),
    ...overrides,
  };
}

export function cancelledRide(
  overrides: Partial<CancelledRide> = {},
): CancelledRide {
  const dto = cancelledRideDto();
  return {
    rideId: dto.rideId,
    status: dto.status,
    cancelledAt: new Date(dto.cancelledAt),
    ...overrides,
  };
}

export function notification(
  overrides: Partial<RideNotification> = {},
): RideNotification {
  const dto = notificationDto();
  return {
    id: dto.id,
    type: dto.type,
    title: dto.title,
    body: dto.body,
    read: dto.read,
    readAt: dto.readAt === null ? null : new Date(dto.readAt),
    rideId: dto.rideId,
    requestId: dto.requestId,
    createdAt: new Date(dto.createdAt),
    ...overrides,
  };
}

/** A fake navigation object for screen tests. */
export function fakeNavigation(): AppNavigation {
  return { navigate: vi.fn(), goBack: vi.fn() };
}

export function reportDto(overrides: Partial<ReportDto> = {}): ReportDto {
  return {
    id: 'report-1',
    reportedUserId: 'user-2',
    rideId: 'ride-1',
    reason: 'HARASSMENT',
    detail: 'was rude at pickup',
    createdAt: ISO_STRING,
    ...overrides,
  };
}

export function blockDto(overrides: Partial<BlockDto> = {}): BlockDto {
  return {
    id: 'block-1',
    blockedUserId: 'user-2',
    createdAt: ISO_STRING,
    unblockedAt: null,
    ...overrides,
  };
}

export function activeBlockDto(
  overrides: Partial<ActiveBlockDto> = {},
): ActiveBlockDto {
  return {
    blockedUserId: 'user-2',
    blockedUserName: 'Bo',
    createdAt: ISO_STRING,
    ...overrides,
  };
}

export function report(overrides: Partial<Report> = {}): Report {
  const dto = reportDto();
  return {
    id: dto.id,
    reportedUserId: dto.reportedUserId,
    rideId: dto.rideId,
    reason: dto.reason,
    detail: dto.detail,
    createdAt: new Date(dto.createdAt),
    ...overrides,
  };
}

export function block(overrides: Partial<Block> = {}): Block {
  const dto = blockDto();
  return {
    id: dto.id,
    blockedUserId: dto.blockedUserId,
    createdAt: new Date(dto.createdAt),
    unblockedAt: dto.unblockedAt === null ? null : new Date(dto.unblockedAt),
    ...overrides,
  };
}

export function activeBlock(overrides: Partial<ActiveBlock> = {}): ActiveBlock {
  const dto = activeBlockDto();
  return {
    blockedUserId: dto.blockedUserId,
    blockedUserName: dto.blockedUserName,
    createdAt: new Date(dto.createdAt),
    ...overrides,
  };
}

/** A default fake `SafetyApi` whose methods resolve deterministically. */
export function fakeSafetyApi(overrides: Partial<SafetyApi> = {}): SafetyApi {
  const api: SafetyApi = {
    createReport: vi.fn(async (): Promise<Report> => report()),
    listMyReports: vi.fn(async (): Promise<Report[]> => []),
    createBlock: vi.fn(async (): Promise<Block> => block()),
    removeBlock: vi.fn(async (): Promise<void> => undefined),
    listMyBlocks: vi.fn(async (): Promise<ActiveBlock[]> => []),
    ...overrides,
  };
  return api;
}

export interface FakeLocationClientOptions {
  /** Status reported by `getPermissionState()` on mount. Defaults to
   * `granted`. */
  permission?: LocationPermissionStatus;
  /** Status returned by `requestPermission()`. Defaults to `permission`. */
  requestResult?: LocationPermissionStatus;
  /** The coordinate returned by `getCurrentLocation()`. */
  coordinate?: Coordinate;
}

export type FakeLocationClient = LocationClient & {
  getPermissionState: Mock<() => Promise<LocationPermissionStatus>>;
  requestPermission: Mock<() => Promise<LocationPermissionStatus>>;
  getCurrentLocation: Mock<() => Promise<Coordinate>>;
};

/** A deterministic fake `LocationClient` (Phase 3.16). Each method is a mock
 * so tests can assert call counts (e.g. no infinite retry, no hidden
 * acquisition). Production never uses these fakes implicitly. */
export function fakeLocationClient(
  options: FakeLocationClientOptions = {},
): FakeLocationClient {
  const permission = options.permission ?? 'granted';
  const requestResult = options.requestResult ?? permission;
  const coordinate = options.coordinate ?? {
    latitude: 12.9716,
    longitude: 77.5946,
  };
  const client: FakeLocationClient = {
    getPermissionState: vi.fn(
      async (): Promise<LocationPermissionStatus> => permission,
    ),
    requestPermission: vi.fn(
      async (): Promise<LocationPermissionStatus> => requestResult,
    ),
    getCurrentLocation: vi.fn(async (): Promise<Coordinate> => coordinate),
  };
  return client;
}

/** A default fake `RideApi` whose methods resolve deterministically. */
export function fakeRideApi(overrides: Partial<RideApi> = {}): RideApi {
  const api: RideApi = {
    discoverRides: vi.fn(async (): Promise<RideSummary[]> => []),
    matchRides: vi.fn(async () => []),
    createRide: vi.fn(async (): Promise<CreatedRide> => createdRide()),
    listMyRides: vi.fn(async (): Promise<CreatorRide[]> => []),
    getRideDetail: vi.fn(async (): Promise<CreatorRide> => creatorRide()),
    requestSeats: vi.fn(async (): Promise<RideRequest> => rideRequest()),
    acceptRequest: vi.fn(async (): Promise<AcceptedRideRequest> => ({
      requestId: 'request-1',
      requestStatus: 'ACCEPTED',
      participantId: 'participant-1',
      participantStatus: 'CONFIRMED',
      rideId: 'ride-1',
      allocatedSeats: 1,
      rideStatus: 'CONFIRMED',
      rideStatusChanged: true,
    })),
    rejectRequest: vi.fn(
      async (): Promise<{
        requestId: string;
        requestStatus: 'REJECTED';
        rideId: string;
      }> => ({
        requestId: 'request-1',
        requestStatus: 'REJECTED',
        rideId: 'ride-1',
      }),
    ),
    cancelRequest: vi.fn(async (): Promise<CancelledRideRequest> => ({
      requestId: 'request-1',
      requestStatus: 'CANCELLED',
      rideId: 'ride-1',
      participantId: null,
      participantStatus: null,
      releasedSeats: 0,
      rideStatus: 'PUBLISHED',
      rideStatusChanged: false,
      cancelledAt: new Date(ISO_STRING),
    })),
    cancelRide: vi.fn(async (): Promise<CancelledRide> => cancelledRide()),
    publishRide: vi.fn(async (): Promise<PublishedRide> => ({
      rideId: 'ride-1',
      status: 'PUBLISHED',
      publishedAt: new Date(ISO_STRING),
    })),
    startRide: vi.fn(async (): Promise<StartedRide> => ({
      rideId: 'ride-1',
      status: 'IN_PROGRESS',
      startedAt: new Date(ISO_STRING),
    })),
    completeRide: vi.fn(async (): Promise<CompletedRide> => ({
      rideId: 'ride-1',
      status: 'COMPLETED',
      completedAt: new Date(ISO_STRING),
    })),
    listNotifications: vi.fn(async () => ({
      notifications: [],
      unreadCount: 0,
      hasMore: false,
    })),
    markNotificationRead: vi.fn(
      async ({ notificationId }): Promise<RideNotification> =>
        notification({ id: notificationId, read: true }),
    ),
    markAllNotificationsRead: vi.fn(async () => ({ updatedCount: 0 })),
    ...overrides,
  };
  return api;
}

export interface FakeGeocodingProviderOptions {
  /** Result of forward queries. Defaults to an empty array. */
  forward?: LocationReference[];
  /** Result of reverse lookups. Defaults to null. */
  reverse?: LocationReference | null;
  /** Throw this error from every call (overrides results). */
  error?: unknown;
  id?: string;
}

export type FakeGeocodingProvider = GeocodingProvider & {
  forwardGeocode: Mock<() => Promise<LocationReference[]>>;
  reverseGeocode: Mock<() => Promise<LocationReference | null>>;
};

/** A deterministic fake `GeocodingProvider` (Phase 3.20). Each method is a
 * mock so tests can assert call counts and arguments. Production never uses
 * these fakes implicitly. */
export function fakeGeocodingProvider(
  options: FakeGeocodingProviderOptions = {},
): FakeGeocodingProvider {
  const { forward = [], reverse = null, error, id = 'fake' } = options;
  if (error !== undefined) {
    return {
      id,
      forwardGeocode: vi.fn(async () => {
        throw error;
      }),
      reverseGeocode: vi.fn(async () => {
        throw error;
      }),
    };
  }
  return {
    id,
    forwardGeocode: vi.fn(async (): Promise<LocationReference[]> => forward),
    reverseGeocode: vi.fn(
      async (): Promise<LocationReference | null> => reverse,
    ),
  };
}

export interface FakeRoutingProviderOptions {
  /** The route returned by `calculateRoute`. */
  route?: RouteResult;
  /** Throw this error from every call. */
  error?: unknown;
  id?: string;
}

export type FakeRoutingProvider = RoutingProvider & {
  calculateRoute: Mock<(request: RouteRequest) => Promise<RouteResult>>;
};

/** A deterministic fake `RoutingProvider` (Phase 3.20). */
export function fakeRoutingProvider(
  options: FakeRoutingProviderOptions = {},
): FakeRoutingProvider {
  const {
    route = { distanceMeters: 5000, durationSeconds: 600 },
    error,
    id = 'fake',
  } = options;
  if (error !== undefined) {
    return {
      id,
      calculateRoute: vi.fn(async (_request: RouteRequest) => {
        throw error;
      }),
    };
  }
  return {
    id,
    calculateRoute: vi.fn(
      async (_request: RouteRequest): Promise<RouteResult> => route,
    ),
  };
}
