import { describe, expect, it, vi } from 'vitest';
import type { ApiClient, ApiRequestOptions } from '../api/client';
import { buildQuery, createRideApi } from './api';
import {
  acceptedRideRequestDto,
  cancelledRideDto,
  cancelledRideRequestDto,
  createdRideDto,
  createdRideRequestDto,
  discoveredRideDto,
  matchedRideDto,
  notificationDto,
} from '../../tests/fixtures';

/** A deterministic fake client that records calls and resolves per-path. */
function fakeClient(responses: Record<string, unknown>): {
  client: ApiClient;
  calls: Array<{ path: string; options?: ApiRequestOptions }>;
} {
  const calls: Array<{ path: string; options?: ApiRequestOptions }> = [];
  const request = vi.fn(
    async (path: string, options?: ApiRequestOptions): Promise<unknown> => {
      calls.push({ path, options });
      if (!(path in responses)) {
        throw new Error(`fakeClient: no response for ${path}`);
      }
      return responses[path];
    },
  );
  const client: ApiClient = {
    request: request as unknown as ApiClient['request'],
  };
  return { client, calls };
}

describe('buildQuery', () => {
  it('omits undefined values and encodes keys/values', () => {
    expect(buildQuery({ a: 1, b: undefined, c: 'x y' })).toBe('a=1&c=x%20y');
  });

  it('returns an empty string for no values', () => {
    expect(buildQuery({ a: undefined })).toBe('');
  });
});

describe('RideApi', () => {
  it('discovers rides at GET /rides/discover with query params', async () => {
    const { client, calls } = fakeClient({
      '/rides/discover?latitude=12.9716&longitude=77.5946&radiusMeters=5000&limit=5':
        [discoveredRideDto()],
    });
    const api = createRideApi(client);
    const rides = await api.discoverRides({
      latitude: 12.9716,
      longitude: 77.5946,
      radiusMeters: 5000,
      limit: 5,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe(
      '/rides/discover?latitude=12.9716&longitude=77.5946&radiusMeters=5000&limit=5',
    );
    expect(calls[0].options?.method).toBeUndefined(); // GET
    expect(rides[0].id).toBe('ride-1');
    expect(rides[0].departureDateTime).toBeInstanceOf(Date);
  });

  it('discovers rides without a limit query when omitted', async () => {
    const { client, calls } = fakeClient({
      '/rides/discover?latitude=1&longitude=2&radiusMeters=1000': [
        discoveredRideDto(),
      ],
    });
    const api = createRideApi(client);
    await api.discoverRides({
      latitude: 1,
      longitude: 2,
      radiusMeters: 1000,
    });
    expect(calls[0].path).toBe(
      '/rides/discover?latitude=1&longitude=2&radiusMeters=1000',
    );
  });

  it('matches rides at POST /rides/match with server-controlled OD-004 policy', async () => {
    const { client, calls } = fakeClient({
      '/rides/match': [matchedRideDto()],
    });
    const api = createRideApi(client);
    const matches = await api.matchRides({
      discovery: { latitude: 1, longitude: 2 },
      destination: { latitude: 12.9352, longitude: 77.6245 },
      preferredDepartureTime: new Date('2026-08-18T10:05:00.000Z'),
      requestedSeats: 2,
    });
    expect(calls[0].path).toBe('/rides/match');
    expect(calls[0].options?.method).toBe('POST');
    expect(calls[0].options?.body).toEqual({
      discovery: { latitude: 1, longitude: 2 },
      destination: { latitude: 12.9352, longitude: 77.6245 },
      preferredDepartureTime: '2026-08-18T10:05:00.000Z',
      requestedSeats: 2,
    });
    expect(matches[0].eligible).toBe(true);
    expect(matches[0].ride.id).toBe('ride-1');
  });

  it('creates a ride at POST /rides with an ISO departure date', async () => {
    const { client, calls } = fakeClient({ '/rides': createdRideDto() });
    const api = createRideApi(client);
    const ride = await api.createRide({
      pickup: { latitude: 1, longitude: 2, label: 'Home' },
      destination: { latitude: 3, longitude: 4 },
      departureDateTime: new Date('2026-08-18T10:05:00.000Z'),
      totalSeats: 4,
      pricingType: 'STANDARD',
      pricePerKm: 2.5,
    });
    expect(calls[0].path).toBe('/rides');
    expect(calls[0].options?.method).toBe('POST');
    expect(calls[0].options?.body).toEqual({
      pickup: { latitude: 1, longitude: 2, label: 'Home' },
      destination: { latitude: 3, longitude: 4, label: undefined },
      departureDateTime: '2026-08-18T10:05:00.000Z',
      totalSeats: 4,
      vehicleType: undefined,
      discoveryRadiusKm: undefined,
      pricingType: 'STANDARD',
      pricePerKm: 2.5,
      estimatedDistanceKm: undefined,
      estimatedContribution: undefined,
    });
    expect(ride.status).toBe('DRAFT');
    expect(ride.departureDateTime).toBeInstanceOf(Date);
  });

  it('requests seats at POST /rides/:rideId/requests', async () => {
    const { client, calls } = fakeClient({
      '/rides/ride-1/requests': createdRideRequestDto(),
    });
    const api = createRideApi(client);
    const request = await api.requestSeats({
      rideId: 'ride-1',
      requestedSeats: 2,
    });
    expect(calls[0].path).toBe('/rides/ride-1/requests');
    expect(calls[0].options?.method).toBe('POST');
    expect(calls[0].options?.body).toEqual({ requestedSeats: 2 });
    expect(request.status).toBe('PENDING');
  });

  it('requests seats with the default count when omitted', async () => {
    const { client, calls } = fakeClient({
      '/rides/ride-1/requests': createdRideRequestDto(),
    });
    const api = createRideApi(client);
    await api.requestSeats({ rideId: 'ride-1' });
    expect(calls[0].options?.body).toEqual({ requestedSeats: undefined });
  });

  it('accepts a request at POST /rides/:rideId/requests/:requestId/accept', async () => {
    const { client, calls } = fakeClient({
      '/rides/ride-1/requests/request-1/accept': acceptedRideRequestDto(),
    });
    const api = createRideApi(client);
    const result = await api.acceptRequest({
      rideId: 'ride-1',
      requestId: 'request-1',
    });
    expect(calls[0].path).toBe('/rides/ride-1/requests/request-1/accept');
    expect(calls[0].options?.method).toBe('POST');
    expect(result.requestStatus).toBe('ACCEPTED');
  });

  it('rejects a request at POST /rides/:rideId/requests/:requestId/reject', async () => {
    const { client, calls } = fakeClient({
      '/rides/ride-1/requests/request-1/reject': {
        requestId: 'request-1',
        requestStatus: 'REJECTED',
        rideId: 'ride-1',
      },
    });
    const api = createRideApi(client);
    const result = await api.rejectRequest({
      rideId: 'ride-1',
      requestId: 'request-1',
    });
    expect(calls[0].path).toBe('/rides/ride-1/requests/request-1/reject');
    expect(calls[0].options?.method).toBe('POST');
    expect(result.requestStatus).toBe('REJECTED');
  });

  it('cancels a request at POST /rides/:rideId/requests/:requestId/cancel', async () => {
    const { client, calls } = fakeClient({
      '/rides/ride-1/requests/request-1/cancel': cancelledRideRequestDto(),
    });
    const api = createRideApi(client);
    const result = await api.cancelRequest({
      rideId: 'ride-1',
      requestId: 'request-1',
    });
    expect(calls[0].path).toBe('/rides/ride-1/requests/request-1/cancel');
    expect(calls[0].options?.method).toBe('POST');
    expect(result.requestStatus).toBe('CANCELLED');
    expect(result.cancelledAt).toBeInstanceOf(Date);
  });

  it('parses an ACCEPTED participation cancellation result', async () => {
    const { client } = fakeClient({
      '/rides/ride-1/requests/request-1/cancel': cancelledRideRequestDto({
        participantId: 'participant-1',
        participantStatus: 'CANCELLED',
        releasedSeats: 1,
        rideStatus: 'PUBLISHED',
        rideStatusChanged: true,
      }),
    });
    const api = createRideApi(client);
    const result = await api.cancelRequest({
      rideId: 'ride-1',
      requestId: 'request-1',
    });
    expect(result.participantId).toBe('participant-1');
    expect(result.participantStatus).toBe('CANCELLED');
    expect(result.releasedSeats).toBe(1);
    expect(result.rideStatusChanged).toBe(true);
  });

  it('cancels a ride at POST /rides/:rideId/cancel', async () => {
    const { client, calls } = fakeClient({
      '/rides/ride-1/cancel': cancelledRideDto(),
    });
    const api = createRideApi(client);
    const result = await api.cancelRide({ rideId: 'ride-1' });
    expect(calls[0].path).toBe('/rides/ride-1/cancel');
    expect(calls[0].options?.method).toBe('POST');
    expect(result.status).toBe('CANCELLED');
  });

  it('lists notifications at GET /notifications without a limit', async () => {
    const { client, calls } = fakeClient({
      '/notifications': {
        notifications: [notificationDto()],
        unreadCount: 1,
        hasMore: false,
      },
    });
    const api = createRideApi(client);
    const result = await api.listNotifications();
    expect(calls[0].path).toBe('/notifications');
    expect(result.notifications[0].id).toBe('notification-1');
    expect(result.unreadCount).toBe(1);
  });

  it('lists notifications with a limit query', async () => {
    const { client, calls } = fakeClient({
      '/notifications?limit=10': {
        notifications: [],
        unreadCount: 0,
        hasMore: false,
      },
    });
    const api = createRideApi(client);
    await api.listNotifications(10);
    expect(calls[0].path).toBe('/notifications?limit=10');
  });

  it('marks a notification read at PATCH /notifications/:id/read', async () => {
    const { client, calls } = fakeClient({
      '/notifications/notification-1/read': notificationDto({
        read: true,
        readAt: '2026-08-18T11:00:00.000Z',
      }),
    });
    const api = createRideApi(client);
    const result = await api.markNotificationRead({
      notificationId: 'notification-1',
    });
    expect(calls[0].path).toBe('/notifications/notification-1/read');
    expect(calls[0].options?.method).toBe('PATCH');
    expect(result.read).toBe(true);
  });

  it('marks all notifications read at PATCH /notifications/read-all', async () => {
    const { client, calls } = fakeClient({
      '/notifications/read-all': { updatedCount: 3 },
    });
    const api = createRideApi(client);
    const result = await api.markAllNotificationsRead();
    expect(calls[0].path).toBe('/notifications/read-all');
    expect(calls[0].options?.method).toBe('PATCH');
    expect(result).toEqual({ updatedCount: 3 });
  });
});
