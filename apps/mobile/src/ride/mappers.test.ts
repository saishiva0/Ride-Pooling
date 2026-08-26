import { describe, expect, it } from 'vitest';
import {
  mapAcceptedRideRequest,
  mapCancelledRide,
  mapCancelledRideRequest,
  mapCreatedRide,
  mapDiscoveredRide,
  mapMatchedRide,
  mapNotification,
  mapNotificationList,
  mapRejectedRideRequest,
  mapRideRequest,
} from './mappers';
import {
  acceptedRideRequestDto,
  cancelledRideDto,
  cancelledRideRequestDto,
  createdRideDto,
  createdRideRequestDto,
  discoveredRideDto,
  ISO_STRING,
  matchedRideDto,
  notificationDto,
} from '../../tests/fixtures';

describe('mapDiscoveredRide', () => {
  it('maps a discovered ride payload to the mobile model', () => {
    const mapped = mapDiscoveredRide(discoveredRideDto());
    expect(mapped.id).toBe('ride-1');
    expect(mapped.creator).toEqual({ id: 'creator-1', name: 'Ava' });
    expect(mapped.pickupLocation).toEqual({
      id: 'loc-1',
      latitude: 12.9716,
      longitude: 77.5946,
      label: 'MG Road',
    });
    expect(mapped.destinationLocation.label).toBe('Koramangala');
    expect(mapped.departureDateTime).toEqual(new Date(ISO_STRING));
    expect(mapped.totalSeats).toBe(4);
    expect(mapped.availableSeats).toBe(3);
    expect(mapped.pricingType).toBe('STANDARD');
    expect(mapped.pricePerKm).toBe(2.5);
    expect(mapped.distanceMeters).toBe(1200);
    expect(mapped.status).toBe('PUBLISHED');
  });

  it('preserves null labels', () => {
    const mapped = mapDiscoveredRide(
      discoveredRideDto({
        pickupLocation: {
          id: 'loc-1',
          latitude: 12.9716,
          longitude: 77.5946,
          label: null,
        },
      }),
    );
    expect(mapped.pickupLocation.label).toBeNull();
  });
});

describe('mapCreatedRide', () => {
  it('maps a created ride payload with parsed dates', () => {
    const mapped = mapCreatedRide(createdRideDto());
    expect(mapped.id).toBe('ride-1');
    expect(mapped.vehicleType).toBe('Sedan');
    expect(mapped.discoveryRadiusKm).toBe(10);
    expect(mapped.estimatedDistanceKm).toBe(5.2);
    expect(mapped.estimatedContribution).toBe(13);
    expect(mapped.status).toBe('DRAFT');
    expect(mapped.departureDateTime).toEqual(new Date(ISO_STRING));
    expect(mapped.createdAt).toEqual(new Date(ISO_STRING));
    expect(mapped.updatedAt).toEqual(new Date(ISO_STRING));
  });
});

describe('mapRideRequest', () => {
  it('maps a created request payload', () => {
    const mapped = mapRideRequest(createdRideRequestDto());
    expect(mapped.id).toBe('request-1');
    expect(mapped.rideId).toBe('ride-1');
    expect(mapped.requester).toEqual({ id: 'user-2', name: 'Bo' });
    expect(mapped.requestedSeats).toBe(1);
    expect(mapped.status).toBe('PENDING');
    expect(mapped.createdAt).toEqual(new Date(ISO_STRING));
  });
});

describe('mapAcceptedRideRequest', () => {
  it('maps the accepted-request payload', () => {
    const mapped = mapAcceptedRideRequest(acceptedRideRequestDto());
    expect(mapped.requestId).toBe('request-1');
    expect(mapped.requestStatus).toBe('ACCEPTED');
    expect(mapped.participantId).toBe('participant-1');
    expect(mapped.allocatedSeats).toBe(1);
    expect(mapped.rideStatus).toBe('CONFIRMED');
    expect(mapped.rideStatusChanged).toBe(true);
  });
});

describe('mapRejectedRideRequest', () => {
  it('maps the rejected-request payload', () => {
    const mapped = mapRejectedRideRequest({
      requestId: 'request-1',
      requestStatus: 'REJECTED',
      rideId: 'ride-1',
    });
    expect(mapped).toEqual({
      requestId: 'request-1',
      requestStatus: 'REJECTED',
      rideId: 'ride-1',
    });
  });
});

describe('mapCancelledRide', () => {
  it('maps the cancelled-ride payload with a parsed date', () => {
    const mapped = mapCancelledRide(cancelledRideDto());
    expect(mapped.rideId).toBe('ride-1');
    expect(mapped.status).toBe('CANCELLED');
    expect(mapped.cancelledAt).toEqual(new Date(ISO_STRING));
  });
});

describe('mapMatchedRide', () => {
  it('maps a matched ride with its factor results', () => {
    const mapped = mapMatchedRide(matchedRideDto());
    expect(mapped.ride.id).toBe('ride-1');
    expect(mapped.eligible).toBe(true);
    expect(mapped.factors).toEqual([
      {
        factor: 'pickupProximity',
        eligible: true,
        reason: 'Within pickup radius',
        value: 1200,
        threshold: 5000,
      },
    ]);
  });
});

describe('mapNotification', () => {
  it('maps an unread notification with a null readAt', () => {
    const mapped = mapNotification(notificationDto());
    expect(mapped.id).toBe('notification-1');
    expect(mapped.type).toBe('RIDE_REQUESTED');
    expect(mapped.title).toBe('New ride request');
    expect(mapped.read).toBe(false);
    expect(mapped.readAt).toBeNull();
    expect(mapped.rideId).toBe('ride-1');
    expect(mapped.requestId).toBe('request-1');
    expect(mapped.createdAt).toEqual(new Date(ISO_STRING));
  });

  it('maps a read notification with a parsed readAt', () => {
    const mapped = mapNotification(
      notificationDto({ read: true, readAt: ISO_STRING }),
    );
    expect(mapped.read).toBe(true);
    expect(mapped.readAt).toEqual(new Date(ISO_STRING));
  });
});

describe('mapNotificationList', () => {
  it('maps the list envelope', () => {
    const mapped = mapNotificationList({
      notifications: [notificationDto()],
      unreadCount: 1,
      hasMore: false,
    });
    expect(mapped.notifications).toHaveLength(1);
    expect(mapped.notifications[0].id).toBe('notification-1');
    expect(mapped.unreadCount).toBe(1);
    expect(mapped.hasMore).toBe(false);
  });
});

describe('mapCancelledRideRequest', () => {
  it('maps a PENDING withdrawal result (no participant fields)', () => {
    const mapped = mapCancelledRideRequest(cancelledRideRequestDto());
    expect(mapped.requestId).toBe('request-1');
    expect(mapped.requestStatus).toBe('CANCELLED');
    expect(mapped.rideId).toBe('ride-1');
    expect(mapped.participantId).toBeNull();
    expect(mapped.participantStatus).toBeNull();
    expect(mapped.releasedSeats).toBe(0);
    expect(mapped.rideStatus).toBe('PUBLISHED');
    expect(mapped.rideStatusChanged).toBe(false);
    expect(mapped.cancelledAt).toEqual(new Date(ISO_STRING));
  });

  it('maps an ACCEPTED participation cancellation with seat release', () => {
    const mapped = mapCancelledRideRequest(
      cancelledRideRequestDto({
        participantId: 'participant-1',
        participantStatus: 'CANCELLED',
        releasedSeats: 2,
        rideStatus: 'PUBLISHED',
        rideStatusChanged: true,
      }),
    );
    expect(mapped.participantId).toBe('participant-1');
    expect(mapped.participantStatus).toBe('CANCELLED');
    expect(mapped.releasedSeats).toBe(2);
    expect(mapped.rideStatusChanged).toBe(true);
  });
});
