/**
 * `useRoute` hook tests (Phase 3.20). Providers are injected (fakes), so no
 * network/native code runs. Pins deduplication, latest-result wins, and error
 * normalization.
 */
import { describe, expect, it } from 'vitest';
import { create, act } from 'react-test-renderer';
import { fakeRoutingProvider } from '../../tests/fixtures';
import { useRoute } from './use-route';
import { MobileError } from '../api/errors';
import type { RouteResult } from '../location/location.types';

function Probe({
  provider,
  onReady,
}: {
  provider: Parameters<typeof useRoute>[0];
  onReady: (result: ReturnType<typeof useRoute>) => void;
}) {
  const hook = useRoute(provider);
  onReady(hook);
  return null;
}

function renderHook(provider: Parameters<typeof useRoute>[0]) {
  let result!: ReturnType<typeof useRoute>;
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

const origin = { latitude: 12.9716, longitude: 77.5946 };
const destination = { latitude: 12.9352, longitude: 77.6245 };

describe('useRoute', () => {
  it('calculates a route through the provider', async () => {
    const provider = fakeRoutingProvider({
      route: { distanceMeters: 5000, durationSeconds: 600 },
    });
    const render = renderHook(provider);
    await act(async () => {
      await render.result.calculateRoute(origin, destination);
    });
    expect(provider.calculateRoute).toHaveBeenCalledWith({
      origin,
      destination,
    });
    expect(render.result.state).toMatchObject({
      status: 'success',
      data: { distanceMeters: 5000, durationSeconds: 600 },
    });
  });

  it('deduplicates an in-flight request for the same pair', async () => {
    let resolveFirst: (value: RouteResult) => void = () => {};
    const provider = fakeRoutingProvider({
      route: { distanceMeters: 1, durationSeconds: 1 },
    });
    provider.calculateRoute.mockImplementationOnce(
      () =>
        new Promise<RouteResult>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const render = renderHook(provider);
    const first = render.result.calculateRoute(origin, destination);
    const second = render.result.calculateRoute(origin, destination);
    await act(async () => {
      resolveFirst({ distanceMeters: 1, durationSeconds: 1 });
      await first;
      await second;
    });
    expect(provider.calculateRoute).toHaveBeenCalledTimes(1);
  });

  it('keeps the latest result when requests are out of order', async () => {
    let resolveA: (value: RouteResult) => void = () => {};
    let resolveB: (value: RouteResult) => void = () => {};
    const provider = fakeRoutingProvider({
      route: { distanceMeters: 1, durationSeconds: 1 },
    });
    provider.calculateRoute
      .mockImplementationOnce(
        () =>
          new Promise<RouteResult>((resolve) => {
            resolveA = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<RouteResult>((resolve) => {
            resolveB = resolve;
          }),
      );
    const render = renderHook(provider);
    const a = render.result.calculateRoute(origin, destination);
    const b = render.result.calculateRoute(
      { latitude: 1, longitude: 1 },
      { latitude: 2, longitude: 2 },
    );
    await act(async () => {
      // B resolves first; A resolves later — A must NOT overwrite B.
      resolveB({ distanceMeters: 2, durationSeconds: 2 });
      await b;
      resolveA({ distanceMeters: 1, durationSeconds: 1 });
      await a;
    });
    expect(render.result.state).toMatchObject({
      status: 'success',
      data: { distanceMeters: 2, durationSeconds: 2 },
    });
  });

  it('normalizes provider failures to a MobileError', async () => {
    const provider = fakeRoutingProvider({
      error: new MobileError('external-service', 'Route is unavailable'),
    });
    const render = renderHook(provider);
    await act(async () => {
      await render.result.calculateRoute(origin, destination);
    });
    expect(render.result.state).toMatchObject({
      status: 'error',
      error: expect.objectContaining({ kind: 'external-service' }),
    });
  });

  it('rejects a fail-closed provider with an external-service error', async () => {
    const provider = fakeRoutingProvider({
      error: new MobileError(
        'external-service',
        'Route calculation is unavailable',
        { details: { provider: 'fail-closed' } },
      ),
      id: 'fail-closed',
    });
    const render = renderHook(provider);
    await act(async () => {
      await render.result.calculateRoute(origin, destination);
    });
    expect(render.result.state.status).toBe('error');
  });
});
