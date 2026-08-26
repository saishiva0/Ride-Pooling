/**
 * LocationPicker component tests (Phase 3.20). Providers are injected (fakes),
 * so no network or native code runs. Pins map-tap → reverse-geocode →
 * confirm flow, current-location flow, and fail-closed behavior.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  fakeGeocodingProvider,
  fakeLocationClient,
} from '../../tests/fixtures';
import {
  renderAndSettle,
  press,
  findAll,
  flushAsync,
} from '../../tests/render';
import { LocationPicker } from './location-picker';

describe('LocationPicker', () => {
  it('reverse-geocodes a map tap and confirms the location', async () => {
    const geocoding = fakeGeocodingProvider({
      reverse: { latitude: 12.9716, longitude: 77.5946, label: 'MG Road' },
    });
    const onConfirm = vi.fn();
    const root = await renderAndSettle(
      <LocationPicker
        title="Pickup"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        geocodingProvider={geocoding}
        locationClient={fakeLocationClient()}
      />,
    );
    const map = findAll(root, { testID: 'ride-pool-map' })[0];
    const onPress = map.props.onPress as (event: unknown) => void;
    onPress({
      nativeEvent: { coordinate: { latitude: 12.9716, longitude: 77.5946 } },
    });
    await flushAsync();
    expect(geocoding.reverseGeocode).toHaveBeenCalledWith({
      latitude: 12.9716,
      longitude: 77.5946,
    });
    await press(root, { accessibilityLabel: 'Confirm pickup' });
    expect(onConfirm).toHaveBeenCalledWith({
      latitude: 12.9716,
      longitude: 77.5946,
      label: 'MG Road',
    });
  });

  it('uses current location when granted', async () => {
    const geocoding = fakeGeocodingProvider({
      reverse: { latitude: 1, longitude: 2, label: 'Here' },
    });
    const locationClient = fakeLocationClient({
      permission: 'granted',
      coordinate: { latitude: 1, longitude: 2 },
    });
    const root = await renderAndSettle(
      <LocationPicker
        title="Destination"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        geocodingProvider={geocoding}
        locationClient={locationClient}
      />,
    );
    await press(root, { accessibilityLabel: 'Use my current location' });
    await flushAsync();
    expect(locationClient.getCurrentLocation).toHaveBeenCalled();
    const label = findAll(root, {
      accessibilityLabel: 'Selected location label',
    })[0];
    expect(label.props.children).toContain('Here');
  });

  it('shows a message when permission is denied (manual flow still available)', async () => {
    const locationClient = fakeLocationClient({ permission: 'denied' });
    const root = await renderAndSettle(
      <LocationPicker
        title="Pickup"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        geocodingProvider={fakeGeocodingProvider()}
        locationClient={locationClient}
      />,
    );
    await press(root, { accessibilityLabel: 'Use my current location' });
    await flushAsync();
    const text = root.root
      .findAllByType('Text' as never)
      .map((node) => String(node.props.children))
      .join(' ');
    expect(text).toContain('Location permission was denied');
  });

  it('renders the map placeholder when the geocoding provider is fail-closed', async () => {
    const root = await renderAndSettle(
      <LocationPicker
        title="Pickup"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        geocodingProvider={fakeGeocodingProvider({ id: 'fail-closed' })}
        locationClient={fakeLocationClient()}
      />,
    );
    const text = root.root
      .findAllByType('Text' as never)
      .map((node) => String(node.props.children))
      .join(' ');
    expect(text).toContain('The map is unavailable');
  });

  it('disables confirm until a location is selected', async () => {
    const onConfirm = vi.fn();
    const root = await renderAndSettle(
      <LocationPicker
        title="Pickup"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        geocodingProvider={fakeGeocodingProvider()}
        locationClient={fakeLocationClient()}
      />,
    );
    const confirm = findAll(root, { accessibilityLabel: 'Confirm pickup' })[0];
    expect(confirm.props.disabled).toBe(true);
  });
});
