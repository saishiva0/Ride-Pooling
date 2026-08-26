import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { Pressable, Text, View } from 'react-native';
import { MobileError } from '../api/errors';
import { useCurrentLocation } from './use-current-location';
import type { LocationClient } from '../location/location-client';
import type { LocationPermissionStatus } from '../location/permission';
import type { Coordinate } from '../location/location.types';
import {
  extractText,
  flushAsync,
  press,
  renderAndSettle,
} from '../../tests/render';
import { fakeLocationClient } from '../../tests/fixtures';

/** Renders the hook's observable surface as one deterministic text line so
 * tests assert on exact state transitions. */
function HookHarness({ client }: { client: LocationClient }) {
  const result = useCurrentLocation(client);
  let line = `permission=${result.permission};status=${result.state.status};`;
  if (result.state.status === 'success') {
    line += `lat=${result.state.coordinate.latitude};lng=${result.state.coordinate.longitude};`;
  }
  if (result.state.status === 'error') {
    line += `kind=${result.state.error.kind};`;
  }
  return (
    <View>
      <Text>{line}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="request-permission"
        onPress={() => {
          void result.requestPermission();
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="get-location"
        onPress={() => {
          void result.getCurrentLocation();
        }}
      />
    </View>
  );
}

const COORDINATE: Coordinate = { latitude: 12.9716, longitude: 77.5946 };

describe('useCurrentLocation (hook state behavior)', () => {
  it('starts unknown/idle and does not acquire location on mount', async () => {
    const getCurrentLocation = vi.fn(
      async (): Promise<Coordinate> => COORDINATE,
    );
    const client = fakeLocationClient({ permission: 'unknown' });
    client.getPermissionState = vi.fn(
      () => new Promise<LocationPermissionStatus>(() => {}),
    );
    client.getCurrentLocation = getCurrentLocation;
    const root = await renderAndSettle(<HookHarness client={client} />);
    expect(extractText(root.toJSON())).toContain(
      'permission=unknown;status=idle',
    );
    // Privacy: nothing acquires location on mount.
    expect(getCurrentLocation).not.toHaveBeenCalled();
  });

  it('transitions idle → requesting → success with the validated coordinate', async () => {
    let resolveLocation!: (coordinate: Coordinate) => void;
    const getCurrentLocation = vi.fn(
      () =>
        new Promise<Coordinate>((resolve) => {
          resolveLocation = resolve;
        }),
    );
    const client = fakeLocationClient();
    client.getCurrentLocation = getCurrentLocation;
    const root = await renderAndSettle(<HookHarness client={client} />);

    await press(root, { accessibilityLabel: 'get-location' });
    expect(extractText(root.toJSON())).toContain('status=requesting');

    await act(async () => {
      resolveLocation(COORDINATE);
    });
    await flushAsync();
    expect(extractText(root.toJSON())).toContain(
      `status=success;lat=12.9716;lng=77.5946`,
    );
  });

  it('ignores a second acquisition while one is in flight (no double GPS)', async () => {
    let resolveLocation!: (coordinate: Coordinate) => void;
    const getCurrentLocation = vi.fn(
      () =>
        new Promise<Coordinate>((resolve) => {
          resolveLocation = resolve;
        }),
    );
    const client = fakeLocationClient();
    client.getCurrentLocation = getCurrentLocation;
    const root = await renderAndSettle(<HookHarness client={client} />);

    await press(root, { accessibilityLabel: 'get-location' });
    await press(root, { accessibilityLabel: 'get-location' });
    expect(getCurrentLocation).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveLocation(COORDINATE);
    });
    await flushAsync();
    expect(extractText(root.toJSON())).toContain('status=success');
  });

  it('turns a NaN coordinate into a normalized validation error, never success', async () => {
    const client = fakeLocationClient();
    client.getCurrentLocation = vi.fn(async (): Promise<Coordinate> => ({
      latitude: NaN,
      longitude: 77.5946,
    }));
    const root = await renderAndSettle(<HookHarness client={client} />);
    await press(root, { accessibilityLabel: 'get-location' });
    await flushAsync();
    expect(extractText(root.toJSON())).toContain(
      'status=error;kind=validation',
    );
  });

  it('turns a native failure into a normalized MobileError (no raw leak)', async () => {
    const client = fakeLocationClient();
    client.getCurrentLocation = vi.fn(async () => {
      throw new Error('CoreLocation error 5: internal native detail');
    });
    const root = await renderAndSettle(<HookHarness client={client} />);
    await press(root, { accessibilityLabel: 'get-location' });
    await flushAsync();
    const text = extractText(root.toJSON());
    expect(text).toContain('status=error;kind=unknown');
    expect(text).not.toContain('CoreLocation');
  });

  it('fails closed when the client rejects with a normalized error', async () => {
    const client = fakeLocationClient();
    client.getCurrentLocation = vi.fn(async (): Promise<Coordinate> => {
      throw new MobileError(
        'location-unavailable',
        'Current location is unavailable',
      );
    });
    const root = await renderAndSettle(<HookHarness client={client} />);
    await press(root, { accessibilityLabel: 'get-location' });
    await flushAsync();
    expect(extractText(root.toJSON())).toContain(
      'status=error;kind=location-unavailable',
    );
  });

  it('does not auto-retry: a failing acquisition stays errored after one call', async () => {
    const getCurrentLocation = vi.fn(async (): Promise<Coordinate> => {
      throw new MobileError(
        'location-unavailable',
        'Current location is unavailable',
      );
    });
    const client = fakeLocationClient();
    client.getCurrentLocation = getCurrentLocation;
    const root = await renderAndSettle(<HookHarness client={client} />);
    await press(root, { accessibilityLabel: 'get-location' });
    await flushAsync();
    expect(extractText(root.toJSON())).toContain('status=error');
    expect(getCurrentLocation).toHaveBeenCalledTimes(1);
  });

  it('supports an explicit retry (user-initiated, not automatic)', async () => {
    const getCurrentLocation = vi
      .fn()
      .mockRejectedValueOnce(new MobileError('timeout', 'timed out'))
      .mockResolvedValueOnce(COORDINATE);
    const client = fakeLocationClient();
    client.getCurrentLocation = getCurrentLocation;
    const root = await renderAndSettle(<HookHarness client={client} />);

    await press(root, { accessibilityLabel: 'get-location' });
    await flushAsync();
    expect(extractText(root.toJSON())).toContain('status=error;kind=timeout');

    await press(root, { accessibilityLabel: 'get-location' });
    await flushAsync();
    expect(extractText(root.toJSON())).toContain('status=success');
    expect(getCurrentLocation).toHaveBeenCalledTimes(2);
  });

  it('resolves permission to denied', async () => {
    const client = fakeLocationClient({ requestResult: 'denied' });
    const root = await renderAndSettle(<HookHarness client={client} />);
    await press(root, { accessibilityLabel: 'request-permission' });
    await flushAsync();
    expect(extractText(root.toJSON())).toContain('permission=denied');
  });

  it('fails permission closed to unavailable when the request throws', async () => {
    const client = fakeLocationClient({ permission: 'unknown' });
    client.requestPermission = vi.fn(async () => {
      throw new Error('native permission internal');
    });
    const root = await renderAndSettle(<HookHarness client={client} />);
    await press(root, { accessibilityLabel: 'request-permission' });
    await flushAsync();
    expect(extractText(root.toJSON())).toContain('permission=unavailable');
  });
});
