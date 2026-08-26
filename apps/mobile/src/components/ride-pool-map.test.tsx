/**
 * RidePoolMap component tests (Phase 3.20). Renders against the deterministic
 * `react-native-maps` mock (vitest alias); asserts markers, polyline, and the
 * fail-closed placeholder without any native SDK.
 */
import { describe, expect, it } from 'vitest';
import { MobileError } from '../api/errors';
import { RidePoolMap } from './ride-pool-map';
import { findAll, renderAndSettle } from '../../tests/render';
import type { Coordinate } from '../location/location.types';

describe('RidePoolMap', () => {
  it('renders the explanatory placeholder when unavailable (fail closed)', async () => {
    const root = await renderAndSettle(
      <RidePoolMap unavailable accessibilityLabel="Discovery map" />,
    );
    const text = root.root
      .findAllByType('Text' as never)
      .map((node) => String(node.props.children))
      .join(' ');
    expect(text).toContain('The map is unavailable');
  });

  it('renders markers for each supplied marker', async () => {
    const root = await renderAndSettle(
      <RidePoolMap
        markers={[
          {
            id: 'ride-1',
            coordinate: { latitude: 12.9716, longitude: 77.5946 },
            kind: 'ride',
            title: 'Ava',
          },
          {
            id: 'ride-2',
            coordinate: { latitude: 12.9352, longitude: 77.6245 },
            kind: 'ride',
            title: 'Bo',
          },
        ]}
      />,
    );
    const marker1 = findAll(root, { identifier: 'ride-1' });
    const marker2 = findAll(root, { identifier: 'ride-2' });
    expect(marker1[0].props.coordinate).toEqual({
      latitude: 12.9716,
      longitude: 77.5946,
    });
    expect(marker2[0].props.coordinate).toEqual({
      latitude: 12.9352,
      longitude: 77.6245,
    });
  });

  it('renders a route polyline from LineString geometry (lng, lat)', async () => {
    const root = await renderAndSettle(
      <RidePoolMap
        route={{
          distanceMeters: 4850,
          durationSeconds: 602,
          geometry: {
            type: 'LineString',
            coordinates: [
              [77.5946, 12.9716],
              [77.6245, 12.9352],
            ],
          },
        }}
      />,
    );
    const polyline = findAll(root, { testID: 'route-polyline' });
    expect(polyline[0].props.coordinates).toEqual([
      { latitude: 12.9716, longitude: 77.5946 },
      { latitude: 12.9352, longitude: 77.6245 },
    ]);
  });

  it('renders the selected location marker', async () => {
    const selected: Coordinate = { latitude: 12.9716, longitude: 77.5946 };
    const root = await renderAndSettle(
      <RidePoolMap selectedCoordinate={selected} />,
    );
    const marker = findAll(root, { identifier: 'selected-location' });
    expect(marker[0].props.coordinate).toEqual({
      latitude: 12.9716,
      longitude: 77.5946,
    });
  });

  it('renders a normalized error overlay', async () => {
    const root = await renderAndSettle(
      <RidePoolMap
        error={new MobileError('external-service', 'Maps service unavailable')}
      />,
    );
    const text = root.root
      .findAllByType('Text' as never)
      .map((node) => String(node.props.children))
      .join(' ');
    expect(text).toContain('temporarily unavailable');
  });

  it('forwards map taps as coordinates to onLocationSelected', async () => {
    let selected: Coordinate | null = null;
    const root = await renderAndSettle(
      <RidePoolMap
        onLocationSelected={(coordinate) => {
          selected = coordinate;
        }}
      />,
    );
    const map = findAll(root, { testID: 'ride-pool-map' })[0];
    const onPress = map.props.onPress as (event: unknown) => void;
    onPress({ nativeEvent: { coordinate: { latitude: 1, longitude: 2 } } });
    expect(selected).toEqual({ latitude: 1, longitude: 2 });
  });

  it('uses Google as the provider (OD-007 → Google Maps)', async () => {
    const root = await renderAndSettle(
      <RidePoolMap initialCoordinate={{ latitude: 12.97, longitude: 77.59 }} />,
    );
    const map = findAll(root, { testID: 'ride-pool-map' })[0];
    expect(map.props.provider).toBe('google');
  });
});
