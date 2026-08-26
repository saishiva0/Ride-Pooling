/**
 * `useGeocoding` hook (Phase 3.20 — GOOGLE MAPS & LOCATION INTEGRATION).
 *
 * The minimal reusable bridge between screens/components and the
 * provider-neutral `GeocodingProvider` port. Exposes forward and reverse
 * geocoding as `AsyncState`, so callers render loading/success/error
 * deterministically. Every failure is a normalized `MobileError` — vendor
 * detail never leaks.
 *
 * The provider is injected (tests use fakes); with the fail-closed provider
 * every call surfaces a normalized `external-service` error.
 */
import { useCallback, useRef } from 'react';
import type { GeocodingProvider } from '../location/geocoding';
import type { Coordinate, LocationReference } from '../location/location.types';
import type { AsyncState } from '../state/async';
import { useAsync } from './use-async';

export interface UseGeocodingResult {
  /** Forward-geocoding state (searching for a place). */
  forward: AsyncState<LocationReference[]>;
  /** Runs a forward-geocoding query against the injected provider. */
  forwardGeocode: (query: string) => Promise<void>;
  /** Reverse-geocoding state (labeling a coordinate). */
  reverse: AsyncState<LocationReference | null>;
  /** Runs a reverse-geocoding lookup against the injected provider. */
  reverseGeocode: (coordinate: Coordinate) => Promise<void>;
}

export function useGeocoding(provider: GeocodingProvider): UseGeocodingResult {
  const forwardQueryRef = useRef<string>('');
  const reverseQueryRef = useRef<Coordinate | null>(null);

  const forwardOperation = useCallback(async (): Promise<
    LocationReference[]
  > => {
    const query = forwardQueryRef.current;
    if (!query.trim()) {
      return [];
    }
    return provider.forwardGeocode(query);
  }, [provider]);
  const reverseOperation =
    useCallback(async (): Promise<LocationReference | null> => {
      const coordinate = reverseQueryRef.current;
      if (coordinate === null) {
        return null;
      }
      return provider.reverseGeocode(coordinate);
    }, [provider]);

  const { state: forward, run: runForward } = useAsync(forwardOperation);
  const { state: reverse, run: runReverse } = useAsync(reverseOperation);

  const forwardGeocode = useCallback(
    async (query: string): Promise<void> => {
      forwardQueryRef.current = query;
      await runForward();
    },
    [runForward],
  );

  const reverseGeocode = useCallback(
    async (coordinate: Coordinate): Promise<void> => {
      reverseQueryRef.current = coordinate;
      await runReverse();
    },
    [runReverse],
  );

  return { forward, forwardGeocode, reverse, reverseGeocode };
}
