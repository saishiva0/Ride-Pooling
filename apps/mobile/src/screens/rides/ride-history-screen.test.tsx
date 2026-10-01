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
import { RideHistoryScreen } from './ride-history-screen';

describe('RideHistoryScreen', () => {
  it('shows an empty state when there are no completed rides', async () => {
    const root = await renderAndSettle(
      <RideHistoryScreen
        navigation={fakeNavigation()}
        rideApi={fakeRideApi({
          listMyRides: vi.fn(async () => [
            creatorRide({ id: 'ride-1', status: 'PUBLISHED' }),
          ]),
        })}
      />,
    );
    expect(extractText(root.toJSON())).toContain(
      'No completed rides yet. Your finished rides will appear here.',
    );
  });

  it('shows only COMPLETED rides', async () => {
    const root = await renderAndSettle(
      <RideHistoryScreen
        navigation={fakeNavigation()}
        rideApi={fakeRideApi({
          listMyRides: vi.fn(async () => [
            creatorRide({ id: 'ride-done', status: 'COMPLETED' }),
            creatorRide({ id: 'ride-active', status: 'IN_PROGRESS' }),
          ]),
        })}
      />,
    );
    const text = extractText(root.toJSON());
    expect(text).toContain('COMPLETED');
    const buttons = (label: string) =>
      root.root.findAll(
        (node) =>
          typeof node.type === 'string' &&
          node.props.accessibilityLabel === label,
      );
    expect(buttons('View ride-done')).toHaveLength(1);
    expect(buttons('View ride-active')).toHaveLength(0);
  });

  it('renders a normalized error and retries', async () => {
    const listMyRides = vi
      .fn()
      .mockRejectedValueOnce(
        new MobileError('network', 'Network request failed'),
      )
      .mockResolvedValueOnce([
        creatorRide({ id: 'ride-done', status: 'COMPLETED' }),
      ]);
    const root = await renderAndSettle(
      <RideHistoryScreen
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
    expect(extractText(root.toJSON())).toContain('COMPLETED');
  });

  it('navigates to ride details for a completed ride', async () => {
    const navigation = fakeNavigation();
    const root = await renderAndSettle(
      <RideHistoryScreen
        navigation={navigation}
        rideApi={fakeRideApi({
          listMyRides: vi.fn(async () => [
            creatorRide({ id: 'ride-done', status: 'COMPLETED' }),
          ]),
        })}
      />,
    );
    await press(root, { accessibilityLabel: 'View ride-done' });
    expect(navigation.navigate).toHaveBeenCalledWith(
      ROUTES.RIDE_DETAILS,
      expect.objectContaining({
        ride: expect.objectContaining({ id: 'ride-done', status: 'COMPLETED' }),
      }),
    );
  });
});
