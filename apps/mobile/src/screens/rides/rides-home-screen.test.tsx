import { describe, expect, it, vi } from 'vitest';
import { MobileError } from '../../api/errors';
import {
  renderAndSettle,
  extractText,
  press,
  typeInto,
} from '../../../tests/render';
import {
  fakeNavigation,
  fakeRideApi,
  rideSummary,
} from '../../../tests/fixtures';
import { ROUTES } from '../../navigation/routes';
import { RidesHomeScreen } from './rides-home-screen';

describe('RidesHomeScreen (discovery)', () => {
  it('shows the initial hint with no results', async () => {
    const root = await renderAndSettle(
      <RidesHomeScreen navigation={fakeNavigation()} rideApi={fakeRideApi()} />,
    );
    const text = extractText(root.toJSON());
    expect(text).toContain('Enter a pickup point to discover rides near you.');
    expect(text).toContain('Find rides');
  });

  it('shows a validation error for an invalid form without calling the API', async () => {
    const rideApi = fakeRideApi();
    const root = await renderAndSettle(
      <RidesHomeScreen navigation={fakeNavigation()} rideApi={rideApi} />,
    );
    await typeInto(root, { accessibilityLabel: 'Latitude' }, '12.9716');
    await typeInto(root, { accessibilityLabel: 'Longitude' }, '200');
    await press(root, { accessibilityLabel: 'Find rides' });
    const text = extractText(root.toJSON());
    expect(text).toContain('Longitude must be between -180 and 180');
    expect(rideApi.discoverRides).not.toHaveBeenCalled();
  });

  it('displays discovered rides and navigates to details on card press', async () => {
    const navigation = fakeNavigation();
    const rideApi = fakeRideApi({
      discoverRides: vi.fn(async () => [
        rideSummary({
          id: 'ride-1',
          pickupLocation: {
            id: 'loc-1',
            latitude: 12.9716,
            longitude: 77.5946,
            label: 'MG Road',
          },
        }),
        rideSummary({
          id: 'ride-2',
          creator: { id: 'creator-2', name: 'Bo' },
          destinationLocation: {
            id: 'loc-3',
            latitude: 12.9352,
            longitude: 77.6245,
            label: 'Indiranagar',
          },
        }),
      ]),
    });
    const root = await renderAndSettle(
      <RidesHomeScreen navigation={navigation} rideApi={rideApi} />,
    );
    await typeInto(root, { accessibilityLabel: 'Latitude' }, '12.9716');
    await typeInto(root, { accessibilityLabel: 'Longitude' }, '77.5946');
    await typeInto(root, { accessibilityLabel: 'Radius in kilometers' }, '5');
    await press(root, { accessibilityLabel: 'Find rides' });

    const text = extractText(root.toJSON());
    expect(text).toContain('MG Road → Koramangala');
    expect(text).toContain('Indiranagar');
    expect(text).toContain('3 of 4 seats');
    expect(rideApi.discoverRides).toHaveBeenCalledWith({
      latitude: 12.9716,
      longitude: 77.5946,
      radiusMeters: 5000,
    });

    await press(root, { accessibilityLabel: /Ride by Ava/ });
    expect(navigation.navigate).toHaveBeenCalledWith(ROUTES.RIDE_DETAILS, {
      ride: expect.objectContaining({ id: 'ride-1' }),
    });
  });

  it('shows an empty state when no rides are found', async () => {
    const rideApi = fakeRideApi({ discoverRides: vi.fn(async () => []) });
    const root = await renderAndSettle(
      <RidesHomeScreen navigation={fakeNavigation()} rideApi={rideApi} />,
    );
    await typeInto(root, { accessibilityLabel: 'Latitude' }, '12.9716');
    await typeInto(root, { accessibilityLabel: 'Longitude' }, '77.5946');
    await typeInto(root, { accessibilityLabel: 'Radius in kilometers' }, '5');
    await press(root, { accessibilityLabel: 'Find rides' });
    expect(extractText(root.toJSON())).toContain(
      'No rides found near this point.',
    );
  });

  it('shows a normalized error and retries', async () => {
    const rideApi = fakeRideApi({
      discoverRides: vi
        .fn()
        .mockRejectedValueOnce(
          new MobileError('network', 'Network request failed', {
            cause: new Error('down'),
          }),
        )
        .mockResolvedValueOnce([rideSummary()]),
    });
    const root = await renderAndSettle(
      <RidesHomeScreen navigation={fakeNavigation()} rideApi={rideApi} />,
    );
    await typeInto(root, { accessibilityLabel: 'Latitude' }, '12.9716');
    await typeInto(root, { accessibilityLabel: 'Longitude' }, '77.5946');
    await typeInto(root, { accessibilityLabel: 'Radius in kilometers' }, '5');
    await press(root, { accessibilityLabel: 'Find rides' });

    expect(extractText(root.toJSON())).toContain(
      'Network request failed. Check your connection and try again.',
    );

    await press(root, { accessibilityLabel: 'Try again' });
    expect(extractText(root.toJSON())).toContain('MG Road → Koramangala');
  });
});
