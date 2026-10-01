import { describe, expect, it, vi } from 'vitest';
import { MobileError } from '../../api/errors';
import { ROUTES } from '../../navigation/routes';
import {
  extractText,
  flushAsync,
  press,
  renderAndSettle,
} from '../../../tests/render';
import {
  creatorRide,
  fakeNavigation,
  fakeRideApi,
} from '../../../tests/fixtures';
import { MyRidesScreen } from './my-rides-screen';

describe('MyRidesScreen', () => {
  it('shows an empty state when the creator has no rides', async () => {
    const root = await renderAndSettle(
      <MyRidesScreen navigation={fakeNavigation()} rideApi={fakeRideApi()} />,
    );
    expect(extractText(root.toJSON())).toContain(
      'No rides yet. Create your first ride to get started.',
    );
  });

  it('renders the creator rides with status and seat availability', async () => {
    const rideApi = fakeRideApi({
      listMyRides: vi.fn(async () => [
        creatorRide({
          id: 'ride-1',
          status: 'PUBLISHED',
          availableSeats: 3,
          totalSeats: 4,
        }),
      ]),
    });
    const root = await renderAndSettle(
      <MyRidesScreen navigation={fakeNavigation()} rideApi={rideApi} />,
    );
    const text = extractText(root.toJSON());
    expect(text).toContain('PUBLISHED');
    expect(text).toContain('Seats: 3 of 4 available');
    expect(rideApi.listMyRides).toHaveBeenCalledTimes(1);
  });

  it('renders a normalized error and retries on demand', async () => {
    const listMyRides = vi
      .fn()
      .mockRejectedValueOnce(
        new MobileError('network', 'Network request failed'),
      )
      .mockResolvedValueOnce([]);
    const root = await renderAndSettle(
      <MyRidesScreen
        navigation={fakeNavigation()}
        rideApi={fakeRideApi({ listMyRides })}
      />,
    );
    expect(extractText(root.toJSON())).toContain(
      'Network request failed. Check your connection and try again.',
    );
    await press(root, { accessibilityLabel: 'Try again' });
    await flushAsync();
    expect(listMyRides).toHaveBeenCalledTimes(2);
    expect(extractText(root.toJSON())).toContain('No rides yet.');
  });

  it('routes a DRAFT ride to the creator action screen', async () => {
    const navigation = fakeNavigation();
    const root = await renderAndSettle(
      <MyRidesScreen
        navigation={navigation}
        rideApi={fakeRideApi({
          listMyRides: vi.fn(async () => [
            creatorRide({ id: 'ride-draft', status: 'DRAFT' }),
          ]),
        })}
      />,
    );
    expect(extractText(root.toJSON())).toContain('Manage Ride');
    await press(root, { accessibilityLabel: 'View ride-draft' });
    expect(navigation.navigate).toHaveBeenCalledWith(ROUTES.ACTIVE_RIDE, {
      rideId: 'ride-draft',
    });
  });

  it('routes an in-progress ride to the creator action screen', async () => {
    const navigation = fakeNavigation();
    const root = await renderAndSettle(
      <MyRidesScreen
        navigation={navigation}
        rideApi={fakeRideApi({
          listMyRides: vi.fn(async () => [
            creatorRide({ id: 'ride-active', status: 'IN_PROGRESS' }),
          ]),
        })}
      />,
    );
    await press(root, { accessibilityLabel: 'View ride-active' });
    expect(navigation.navigate).toHaveBeenCalledWith(ROUTES.ACTIVE_RIDE, {
      rideId: 'ride-active',
    });
  });

  it('routes a completed ride to ride history', async () => {
    const navigation = fakeNavigation();
    const root = await renderAndSettle(
      <MyRidesScreen
        navigation={navigation}
        rideApi={fakeRideApi({
          listMyRides: vi.fn(async () => [
            creatorRide({ id: 'ride-done', status: 'COMPLETED' }),
          ]),
        })}
      />,
    );
    expect(extractText(root.toJSON())).toContain('View History');
    await press(root, { accessibilityLabel: 'View ride-done' });
    expect(navigation.navigate).toHaveBeenCalledWith(ROUTES.RIDE_HISTORY);
  });

  it('routes a cancelled ride to its details', async () => {
    const navigation = fakeNavigation();
    const root = await renderAndSettle(
      <MyRidesScreen
        navigation={navigation}
        rideApi={fakeRideApi({
          listMyRides: vi.fn(async () => [
            creatorRide({ id: 'ride-cancelled', status: 'CANCELLED' }),
          ]),
        })}
      />,
    );
    await press(root, { accessibilityLabel: 'View ride-cancelled' });
    expect(navigation.navigate).toHaveBeenCalledWith(
      ROUTES.RIDE_DETAILS,
      expect.objectContaining({
        ride: expect.objectContaining({ id: 'ride-cancelled' }),
      }),
    );
  });
});
