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
import { ActiveRideScreen } from './active-ride-screen';

describe('ActiveRideScreen', () => {
  it('publishes a DRAFT ride and reloads it', async () => {
    const getRideDetail = vi.fn(async () => creatorRide({ status: 'DRAFT' }));
    const publishRide = vi.fn(async () => ({
      rideId: 'ride-1',
      status: 'PUBLISHED' as const,
      publishedAt: new Date('2026-08-18T11:00:00.000Z'),
    }));
    const root = await renderAndSettle(
      <ActiveRideScreen
        navigation={fakeNavigation()}
        rideId="ride-1"
        rideApi={fakeRideApi({ getRideDetail, publishRide })}
      />,
    );
    await flushAsync();

    const before = extractText(root.toJSON());
    expect(before).toContain('Publish Ride');
    expect(before).not.toContain('Start Ride');

    await press(root, { accessibilityLabel: 'Publish ride' });
    await flushAsync();

    expect(publishRide).toHaveBeenCalledWith({ rideId: 'ride-1' });
    expect(getRideDetail).toHaveBeenCalledTimes(2);
    expect(extractText(root.toJSON())).toContain('Ride published at');
  });

  it('starts a PUBLISHED ride and reloads it', async () => {
    const startRide = vi.fn(async () => ({
      rideId: 'ride-1',
      status: 'IN_PROGRESS' as const,
      startedAt: new Date('2026-08-18T11:00:00.000Z'),
    }));
    const root = await renderAndSettle(
      <ActiveRideScreen
        navigation={fakeNavigation()}
        rideId="ride-1"
        rideApi={fakeRideApi({
          getRideDetail: vi.fn(async () =>
            creatorRide({ status: 'PUBLISHED' }),
          ),
          startRide,
        })}
      />,
    );
    await flushAsync();
    expect(extractText(root.toJSON())).toContain('Start Ride');

    await press(root, { accessibilityLabel: 'Start ride' });
    await flushAsync();
    expect(startRide).toHaveBeenCalledWith({ rideId: 'ride-1' });
    expect(extractText(root.toJSON())).toContain('Ride started at');
  });

  it('completes an IN_PROGRESS ride and reloads it', async () => {
    const completeRide = vi.fn(async () => ({
      rideId: 'ride-1',
      status: 'COMPLETED' as const,
      completedAt: new Date('2026-08-18T12:00:00.000Z'),
    }));
    const root = await renderAndSettle(
      <ActiveRideScreen
        navigation={fakeNavigation()}
        rideId="ride-1"
        rideApi={fakeRideApi({
          getRideDetail: vi.fn(async () =>
            creatorRide({ status: 'IN_PROGRESS' }),
          ),
          completeRide,
        })}
      />,
    );
    await flushAsync();
    expect(extractText(root.toJSON())).toContain('Complete Ride');

    await press(root, { accessibilityLabel: 'Complete ride' });
    await flushAsync();
    expect(completeRide).toHaveBeenCalledWith({ rideId: 'ride-1' });
    expect(extractText(root.toJSON())).toContain('Ride completed at');
  });

  it('renders a normalized error when the ride cannot be loaded', async () => {
    const getRideDetail = vi
      .fn()
      .mockRejectedValue(new MobileError('not-found', 'Ride not found', {}));
    const root = await renderAndSettle(
      <ActiveRideScreen
        navigation={fakeNavigation()}
        rideId="ride-1"
        rideApi={fakeRideApi({ getRideDetail })}
      />,
    );
    await flushAsync();
    expect(extractText(root.toJSON())).toContain('Not found.');
    await press(root, { accessibilityLabel: 'Try again' });
    await flushAsync();
    expect(getRideDetail).toHaveBeenCalledTimes(2);
  });

  it('navigates back to My Rides', async () => {
    const navigation = fakeNavigation();
    const root = await renderAndSettle(
      <ActiveRideScreen
        navigation={navigation}
        rideId="ride-1"
        rideApi={fakeRideApi({
          getRideDetail: vi.fn(async () =>
            creatorRide({ status: 'IN_PROGRESS' }),
          ),
        })}
      />,
    );
    await flushAsync();
    await press(root, { accessibilityLabel: 'Back to My Rides' });
    expect(navigation.navigate).toHaveBeenCalledWith(ROUTES.MY_RIDES);
  });
});
