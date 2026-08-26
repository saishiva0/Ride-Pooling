import { describe, expect, it, vi } from 'vitest';
import { MobileError } from '../../api/errors';
import { ROUTES } from '../../navigation/routes';
import {
  renderAndSettle,
  extractText,
  press,
  typeInto,
} from '../../../tests/render';
import {
  cancelledRide,
  fakeNavigation,
  fakeRideApi,
  rideRequest,
  rideSummary,
} from '../../../tests/fixtures';
import { RideDetailsScreen } from './ride-details-screen';

describe('RideDetailsScreen', () => {
  it('shows ride details and requests seats for a participant', async () => {
    const onRequested = vi.fn();
    const ride = rideSummary();
    const rideApi = fakeRideApi({
      requestSeats: vi.fn(async () =>
        rideRequest({ id: 'request-9', requestedSeats: 2 }),
      ),
    });
    const root = await renderAndSettle(
      <RideDetailsScreen
        navigation={fakeNavigation()}
        ride={ride}
        userId="user-other"
        rideApi={rideApi}
        onRequested={onRequested}
      />,
    );

    const text = extractText(root.toJSON());
    expect(text).toContain('MG Road → Koramangala');
    expect(text).toContain('Seats: 3 of 4 available');
    expect(text).toContain('Status: PUBLISHED');

    await typeInto(root, { accessibilityLabel: 'Requested seats' }, '2');
    await press(root, { accessibilityLabel: 'Request to join' });

    expect(rideApi.requestSeats).toHaveBeenCalledWith({
      rideId: 'ride-1',
      requestedSeats: 2,
    });
    expect(onRequested).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'request-9', requestedSeats: 2 }),
      ride,
    );
    expect(extractText(root.toJSON())).toContain('Request sent');
  });

  it('rejects an invalid seat count without calling the API', async () => {
    const rideApi = fakeRideApi();
    const root = await renderAndSettle(
      <RideDetailsScreen
        navigation={fakeNavigation()}
        ride={rideSummary({ availableSeats: 1 })}
        userId="user-other"
        rideApi={rideApi}
      />,
    );
    await typeInto(root, { accessibilityLabel: 'Requested seats' }, '2');
    await press(root, { accessibilityLabel: 'Request to join' });
    expect(extractText(root.toJSON())).toContain('At most 1 seat available');
    expect(rideApi.requestSeats).not.toHaveBeenCalled();
  });

  it('shows a normalized conflict error when the request already exists', async () => {
    const rideApi = fakeRideApi({
      requestSeats: vi.fn(async () => {
        throw new MobileError(
          'conflict',
          'You already have an active request for this ride',
          {
            code: 'CONFLICT',
          },
        );
      }),
    });
    const root = await renderAndSettle(
      <RideDetailsScreen
        navigation={fakeNavigation()}
        ride={rideSummary()}
        userId="user-other"
        rideApi={rideApi}
      />,
    );
    await press(root, { accessibilityLabel: 'Request to join' });
    expect(extractText(root.toJSON())).toContain(
      'This action conflicts with the current state. Refresh and try again.',
    );
  });

  it('does not show the request form for the ride creator', async () => {
    const rideApi = fakeRideApi();
    const root = await renderAndSettle(
      <RideDetailsScreen
        navigation={fakeNavigation()}
        ride={rideSummary({ creator: { id: 'creator-1', name: 'Ava' } })}
        userId="creator-1"
        rideApi={rideApi}
      />,
    );
    const text = extractText(root.toJSON());
    expect(text).toContain('You created this ride.');
    expect(text).not.toContain('Request to join');
  });

  it('lets the creator cancel their ride', async () => {
    const rideApi = fakeRideApi({
      cancelRide: vi.fn(async () =>
        cancelledRide({ cancelledAt: new Date('2026-08-18T11:00:00.000Z') }),
      ),
    });
    const root = await renderAndSettle(
      <RideDetailsScreen
        navigation={fakeNavigation()}
        ride={rideSummary({ creator: { id: 'creator-1', name: 'Ava' } })}
        userId="creator-1"
        rideApi={rideApi}
      />,
    );
    await press(root, { accessibilityLabel: 'Cancel ride' });
    expect(rideApi.cancelRide).toHaveBeenCalledWith({ rideId: 'ride-1' });
    expect(extractText(root.toJSON())).toContain(
      'This ride was cancelled. It is no longer discoverable.',
    );
  });

  it('does not show the cancel action for non-creators', async () => {
    const root = await renderAndSettle(
      <RideDetailsScreen
        navigation={fakeNavigation()}
        ride={rideSummary()}
        userId="user-other"
        rideApi={fakeRideApi()}
      />,
    );
    const text = extractText(root.toJSON());
    expect(text).not.toContain('Cancel ride');
    expect(text).toContain('Request to join');
  });

  it('notes when a ride is not open to requests', async () => {
    const root = await renderAndSettle(
      <RideDetailsScreen
        navigation={fakeNavigation()}
        ride={rideSummary({ status: 'CANCELLED' })}
        userId="user-other"
        rideApi={fakeRideApi()}
      />,
    );
    expect(extractText(root.toJSON())).toContain(
      'This ride is not open to requests in its current state.',
    );
  });

  it('lets a non-creator navigate to report the ride creator (Phase 3.24)', async () => {
    const navigation = fakeNavigation();
    const root = await renderAndSettle(
      <RideDetailsScreen
        navigation={navigation}
        ride={rideSummary({ creator: { id: 'creator-1', name: 'Ava' } })}
        userId="user-other"
        rideApi={fakeRideApi()}
      />,
    );
    await press(root, { accessibilityLabel: 'Report user' });
    expect(navigation.navigate).toHaveBeenCalledWith(ROUTES.REPORT_USER, {
      targetUserId: 'creator-1',
      targetUserName: 'Ava',
      rideId: 'ride-1',
    });
  });

  it('lets a non-creator navigate to block the ride creator (Phase 3.24)', async () => {
    const navigation = fakeNavigation();
    const root = await renderAndSettle(
      <RideDetailsScreen
        navigation={navigation}
        ride={rideSummary({ creator: { id: 'creator-1', name: 'Ava' } })}
        userId="user-other"
        rideApi={fakeRideApi()}
      />,
    );
    await press(root, { accessibilityLabel: 'Block user' });
    expect(navigation.navigate).toHaveBeenCalledWith(ROUTES.BLOCK_USER, {
      targetUserId: 'creator-1',
      targetUserName: 'Ava',
    });
  });

  it('does not show report/block actions for the ride creator', async () => {
    const root = await renderAndSettle(
      <RideDetailsScreen
        navigation={fakeNavigation()}
        ride={rideSummary({ creator: { id: 'creator-1', name: 'Ava' } })}
        userId="creator-1"
        rideApi={fakeRideApi()}
      />,
    );
    const text = extractText(root.toJSON());
    expect(text).not.toContain('Report Ava');
    expect(text).not.toContain('Block Ava');
  });
});
