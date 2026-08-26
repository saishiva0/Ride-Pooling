import { describe, expect, it, vi } from 'vitest';
import { MobileError } from '../../api/errors';
import {
  renderAndSettle,
  extractText,
  findAll,
  flushAsync,
  press,
  typeInto,
} from '../../../tests/render';
import {
  fakeLocationClient,
  fakeNavigation,
  fakeRideApi,
} from '../../../tests/fixtures';
import type { LocationClient } from '../../location/location-client';
import { RidesHomeScreen } from './rides-home-screen';

const inputValue = (
  root: Awaited<ReturnType<typeof renderAndSettle>>,
  accessibilityLabel: string,
): string => {
  const [node] = findAll(root, { accessibilityLabel });
  return String(node.props.value ?? '');
};

describe('RidesHomeScreen (current location integration, Phase 3.16)', () => {
  it('shows the location action and a default fail-closed message with no injected client', async () => {
    const root = await renderAndSettle(
      <RidesHomeScreen navigation={fakeNavigation()} rideApi={fakeRideApi()} />,
    );
    const text = extractText(root.toJSON());
    expect(text).toContain('Use my current location');
    expect(text).toContain(
      'Location is not available on this device. You can still enter coordinates manually.',
    );
  });

  it('pressing the location button populates Latitude and Longitude when permitted', async () => {
    const locationClient = fakeLocationClient();
    const root = await renderAndSettle(
      <RidesHomeScreen
        navigation={fakeNavigation()}
        rideApi={fakeRideApi()}
        locationClient={locationClient}
      />,
    );
    expect(inputValue(root, 'Latitude')).toBe('');
    expect(inputValue(root, 'Longitude')).toBe('');

    await press(root, { accessibilityLabel: 'Use my current location' });
    await flushAsync();

    expect(inputValue(root, 'Latitude')).toBe('12.9716');
    expect(inputValue(root, 'Longitude')).toBe('77.5946');
    expect(extractText(root.toJSON())).toContain(
      'Current location added to the form.',
    );
  });

  it('does not discover automatically when location is used (no hidden network call)', async () => {
    const rideApi = fakeRideApi();
    const locationClient = fakeLocationClient();
    const root = await renderAndSettle(
      <RidesHomeScreen
        navigation={fakeNavigation()}
        rideApi={rideApi}
        locationClient={locationClient}
      />,
    );
    await press(root, { accessibilityLabel: 'Use my current location' });
    await flushAsync();
    expect(rideApi.discoverRides).not.toHaveBeenCalled();
  });

  it('does not acquire location on mount (privacy: nothing runs in the background)', async () => {
    const locationClient = fakeLocationClient();
    await renderAndSettle(
      <RidesHomeScreen
        navigation={fakeNavigation()}
        rideApi={fakeRideApi()}
        locationClient={locationClient}
      />,
    );
    expect(locationClient.getPermissionState).toHaveBeenCalledTimes(1);
    expect(locationClient.getCurrentLocation).not.toHaveBeenCalled();
  });

  it('shows a denial message, leaves fields untouched, and keeps manual discovery working', async () => {
    const rideApi = fakeRideApi();
    const locationClient = fakeLocationClient({
      permission: 'unknown',
      requestResult: 'denied',
    });
    const root = await renderAndSettle(
      <RidesHomeScreen
        navigation={fakeNavigation()}
        rideApi={rideApi}
        locationClient={locationClient}
      />,
    );
    await press(root, { accessibilityLabel: 'Use my current location' });
    await flushAsync();

    expect(extractText(root.toJSON())).toContain(
      'Location permission was denied. You can still enter coordinates manually.',
    );
    expect(inputValue(root, 'Latitude')).toBe('');
    expect(inputValue(root, 'Longitude')).toBe('');

    await typeInto(root, { accessibilityLabel: 'Latitude' }, '12.9716');
    await typeInto(root, { accessibilityLabel: 'Longitude' }, '77.5946');
    await typeInto(root, { accessibilityLabel: 'Radius in kilometers' }, '5');
    await press(root, { accessibilityLabel: 'Find rides' });
    expect(rideApi.discoverRides).toHaveBeenCalledWith({
      latitude: 12.9716,
      longitude: 77.5946,
      radiusMeters: 5000,
    });
  });

  it('shows a normalized acquisition error once, with no auto-retry, and manual flow still works', async () => {
    const getCurrentLocation = vi.fn(async () => {
      throw new MobileError(
        'location-unavailable',
        'Current location is unavailable',
      );
    });
    const locationClient = fakeLocationClient();
    locationClient.getCurrentLocation = getCurrentLocation;
    const rideApi = fakeRideApi();
    const root = await renderAndSettle(
      <RidesHomeScreen
        navigation={fakeNavigation()}
        rideApi={rideApi}
        locationClient={locationClient}
      />,
    );
    await press(root, { accessibilityLabel: 'Use my current location' });
    await flushAsync();

    const text = extractText(root.toJSON());
    expect(text).toContain(
      'Your current location could not be determined. You can still enter coordinates manually.',
    );
    expect(getCurrentLocation).toHaveBeenCalledTimes(1);

    await typeInto(root, { accessibilityLabel: 'Latitude' }, '12.9716');
    await typeInto(root, { accessibilityLabel: 'Longitude' }, '77.5946');
    await typeInto(root, { accessibilityLabel: 'Radius in kilometers' }, '5');
    await press(root, { accessibilityLabel: 'Find rides' });
    expect(rideApi.discoverRides).toHaveBeenCalledTimes(1);
  });

  it('sends the acquired location when the user explicitly presses Find rides', async () => {
    const rideApi = fakeRideApi();
    const locationClient = fakeLocationClient();
    const root = await renderAndSettle(
      <RidesHomeScreen
        navigation={fakeNavigation()}
        rideApi={rideApi}
        locationClient={locationClient}
      />,
    );
    await press(root, { accessibilityLabel: 'Use my current location' });
    await flushAsync();
    await typeInto(root, { accessibilityLabel: 'Radius in kilometers' }, '2.5');
    await press(root, { accessibilityLabel: 'Find rides' });

    expect(rideApi.discoverRides).toHaveBeenCalledWith({
      latitude: 12.9716,
      longitude: 77.5946,
      radiusMeters: 2500,
    });
  });

  it('runs the permission request through the injected client, never a native API', async () => {
    const requestPermission = vi.fn(async () => 'granted' as const);
    const locationClient = {
      getPermissionState: vi.fn(async () => 'unknown' as const),
      requestPermission,
      getCurrentLocation: vi.fn(async () => ({ latitude: 1, longitude: 2 })),
    } satisfies LocationClient;
    const root = await renderAndSettle(
      <RidesHomeScreen
        navigation={fakeNavigation()}
        rideApi={fakeRideApi()}
        locationClient={locationClient}
      />,
    );
    await press(root, { accessibilityLabel: 'Use my current location' });
    await flushAsync();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(inputValue(root, 'Latitude')).toBe('1');
  });
});
