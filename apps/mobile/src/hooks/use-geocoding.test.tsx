/**
 * `useGeocoding` hook tests (Phase 3.20). The provider is injected (fake), so
 * no network/native code runs. Pins forward/reverse state transitions and
 * error normalization.
 */
import { describe, expect, it } from 'vitest';
import { act, create } from 'react-test-renderer';
import { fakeGeocodingProvider } from '../../tests/fixtures';
import { useGeocoding } from './use-geocoding';
import { MobileError } from '../api/errors';

function Probe({
  provider,
  onReady,
}: {
  provider: Parameters<typeof useGeocoding>[0];
  onReady: (result: ReturnType<typeof useGeocoding>) => void;
}) {
  const hook = useGeocoding(provider);
  onReady(hook);
  return null;
}

function renderHook(provider: Parameters<typeof useGeocoding>[0]) {
  let result!: ReturnType<typeof useGeocoding>;
  act(() => {
    create(
      <Probe
        provider={provider}
        onReady={(value) => {
          result = value;
        }}
      />,
    );
  });
  return {
    get result() {
      return result;
    },
  };
}

describe('useGeocoding', () => {
  it('runs forward geocoding and settles to success', async () => {
    const provider = fakeGeocodingProvider({
      forward: [{ latitude: 12.9716, longitude: 77.5946, label: 'MG Road' }],
    });
    const render = renderHook(provider);
    await act(async () => {
      await render.result.forwardGeocode('MG Road');
    });
    expect(provider.forwardGeocode).toHaveBeenCalledWith('MG Road');
    expect(render.result.forward).toMatchObject({
      status: 'success',
      data: [{ latitude: 12.9716, longitude: 77.5946, label: 'MG Road' }],
    });
  });

  it('runs reverse geocoding and settles to success', async () => {
    const provider = fakeGeocodingProvider({
      reverse: { latitude: 12.9716, longitude: 77.5946, label: 'MG Road' },
    });
    const render = renderHook(provider);
    await act(async () => {
      await render.result.reverseGeocode({
        latitude: 12.9716,
        longitude: 77.5946,
      });
    });
    expect(provider.reverseGeocode).toHaveBeenCalledWith({
      latitude: 12.9716,
      longitude: 77.5946,
    });
    expect(render.result.reverse).toMatchObject({
      status: 'success',
      data: { latitude: 12.9716, longitude: 77.5946, label: 'MG Road' },
    });
  });

  it('normalizes provider failures into error state', async () => {
    const provider = fakeGeocodingProvider({
      error: new MobileError('external-service', 'Geocoding unavailable'),
    });
    const render = renderHook(provider);
    await act(async () => {
      await render.result.forwardGeocode('MG Road');
    });
    expect(render.result.forward).toMatchObject({
      status: 'error',
      error: expect.objectContaining({ kind: 'external-service' }),
    });
  });

  it('does not call the provider for a blank query', async () => {
    const provider = fakeGeocodingProvider({ forward: [] });
    const render = renderHook(provider);
    await act(async () => {
      await render.result.forwardGeocode('   ');
    });
    expect(provider.forwardGeocode).not.toHaveBeenCalled();
    expect(render.result.forward).toMatchObject({
      status: 'success',
      data: [],
    });
  });

  it('uses the latest query for each run', async () => {
    const provider = fakeGeocodingProvider({
      forward: [{ latitude: 1, longitude: 1, label: 'First' }],
    });
    const render = renderHook(provider);
    await act(async () => {
      await render.result.forwardGeocode('First query');
    });
    expect(provider.forwardGeocode).toHaveBeenCalledWith('First query');
    expect(render.result.forward).toMatchObject({
      status: 'success',
      data: [{ latitude: 1, longitude: 1, label: 'First' }],
    });
  });
});
