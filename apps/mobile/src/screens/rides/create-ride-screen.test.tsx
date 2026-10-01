import { describe, expect, it, vi } from 'vitest';
import { MobileError } from '../../api/errors';
import { ROUTES } from '../../navigation/routes';
import {
  extractText,
  flushAsync,
  press,
  renderAndSettle,
  typeInto,
} from '../../../tests/render';
import {
  createdRide,
  fakeGeocodingProvider,
  fakeLocationClient,
  fakeNavigation,
  fakeRideApi,
} from '../../../tests/fixtures';
import { CreateRideScreen } from './create-ride-screen';

/**
 * Fills every required field with valid values. The departure date is far in
 * the future so the deterministic "must be in the future" rule always holds.
 */
async function fillValidForm(
  root: Awaited<ReturnType<typeof renderAndSettle>>,
): Promise<void> {
  await typeInto(root, { accessibilityLabel: 'Pickup latitude' }, '12.9716');
  await typeInto(root, { accessibilityLabel: 'Pickup longitude' }, '77.5946');
  await typeInto(root, { accessibilityLabel: 'Destination latitude' }, '13.0');
  await typeInto(root, { accessibilityLabel: 'Destination longitude' }, '78.0');
  await typeInto(
    root,
    { accessibilityLabel: 'Departure date/time' },
    '2999-01-01T00:00:00.000Z',
  );
  await typeInto(root, { accessibilityLabel: 'Total seats' }, '2');
  await typeInto(root, { accessibilityLabel: 'Price per km' }, '4');
}

function renderCreateRide(overrides: Parameters<typeof fakeRideApi>[0] = {}) {
  return renderAndSettle(
    <CreateRideScreen
      navigation={fakeNavigation()}
      rideApi={fakeRideApi(overrides)}
      geocodingProvider={fakeGeocodingProvider()}
      locationClient={fakeLocationClient()}
    />,
  );
}

describe('CreateRideScreen', () => {
  it('renders the canonical create-ride fields', async () => {
    const root = await renderCreateRide();
    const text = extractText(root.toJSON());
    expect(text).toContain('Create a new ride.');
    expect(text).toContain('Pickup');
    expect(text).toContain('Destination');
    expect(text).toContain('Departure');
    expect(text).toContain('Seats & Vehicle');
    expect(text).toContain('Pricing');
    expect(text).toContain('Create ride (DRAFT)');
  });

  it('rejects an invalid form without calling the API', async () => {
    const rideApi = fakeRideApi();
    const root = await renderAndSettle(
      <CreateRideScreen
        navigation={fakeNavigation()}
        rideApi={rideApi}
        geocodingProvider={fakeGeocodingProvider()}
        locationClient={fakeLocationClient()}
      />,
    );
    await press(root, { accessibilityLabel: 'Create ride' });
    expect(extractText(root.toJSON())).toContain('Pickup latitude is required');
    expect(rideApi.createRide).not.toHaveBeenCalled();
  });

  it('creates a DRAFT ride through the API with the parsed input', async () => {
    const rideApi = fakeRideApi({
      createRide: vi.fn(async () => createdRide({ id: 'ride-7' })),
    });
    const root = await renderAndSettle(
      <CreateRideScreen
        navigation={fakeNavigation()}
        rideApi={rideApi}
        geocodingProvider={fakeGeocodingProvider()}
        locationClient={fakeLocationClient()}
      />,
    );
    await fillValidForm(root);
    await press(root, { accessibilityLabel: 'Create ride' });
    await flushAsync();

    expect(rideApi.createRide).toHaveBeenCalledWith(
      expect.objectContaining({
        pickup: expect.objectContaining({
          latitude: 12.9716,
          longitude: 77.5946,
        }),
        destination: expect.objectContaining({ latitude: 13, longitude: 78 }),
        totalSeats: 2,
        pricePerKm: 4,
        pricingType: 'STANDARD',
      }),
    );
    const text = extractText(root.toJSON());
    expect(text).toContain('Ride created in DRAFT status!');
    expect(text).toContain('ID: ride-7');
  });

  it('navigates to My Rides after a successful creation', async () => {
    const navigation = fakeNavigation();
    const root = await renderAndSettle(
      <CreateRideScreen
        navigation={navigation}
        rideApi={fakeRideApi()}
        geocodingProvider={fakeGeocodingProvider()}
        locationClient={fakeLocationClient()}
      />,
    );
    await fillValidForm(root);
    await press(root, { accessibilityLabel: 'Create ride' });
    await flushAsync();
    await press(root, { accessibilityLabel: 'Go to My Rides' });
    expect(navigation.navigate).toHaveBeenCalledWith(ROUTES.MY_RIDES);
  });

  it('renders a normalized error when the API rejects the creation', async () => {
    const rideApi = fakeRideApi({
      createRide: vi.fn(async () => {
        throw new MobileError('conflict', 'Ride already exists', {
          code: 'CONFLICT',
        });
      }),
    });
    const root = await renderAndSettle(
      <CreateRideScreen
        navigation={fakeNavigation()}
        rideApi={rideApi}
        geocodingProvider={fakeGeocodingProvider()}
        locationClient={fakeLocationClient()}
      />,
    );
    await fillValidForm(root);
    await press(root, { accessibilityLabel: 'Create ride' });
    await flushAsync();
    expect(extractText(root.toJSON())).toContain(
      'This action conflicts with the current state. Refresh and try again.',
    );
  });
});
