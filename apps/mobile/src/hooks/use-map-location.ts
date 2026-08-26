/**
 * `useMapLocation` hook (Phase 3.20 — GOOGLE MAPS & LOCATION INTEGRATION).
 *
 * Coordinates the pieces of a "pick a place on the map" flow used by the
 * discovery screen: the map's tapped coordinate is reverse-geocoded into a
 * `LocationReference` (label when available), the current location can be used
 * directly, and everything settles into a single validated `selected`
 * location. Failures are normalized `MobileError`s; with no geocoding provider
 * the coordinate is still usable (label absent).
 *
 * The geocoding provider is injected (tests use fakes). This hook never calls
 * the ride API and never touches native location/map modules directly. The
 * screen owns ONE `useCurrentLocation` instance and passes it in — the hook
 * never spawns a second permission read (the privacy tests pin exactly one
 * `getPermissionState` call on mount).
 */
import { useCallback, useState } from 'react';
import type { GeocodingProvider } from '../location/geocoding';
import type { Coordinate, LocationReference } from '../location/location.types';
import type { UseCurrentLocationResult } from './use-current-location';

export interface UseMapLocationResult {
  /** The selected location (validated coordinate + optional label). */
  selected: LocationReference | null;
  /** True when a reverse-geocode label lookup is in flight. */
  labeling: boolean;
  /** The current-location acquisition state (permission + acquisition). */
  current: UseCurrentLocationResult;
  /** Selects a coordinate from the map, reverse-geocoding a label. */
  selectFromMap: (coordinate: Coordinate) => Promise<void>;
  /** Selects a location directly from search results. */
  selectFromSearch: (location: LocationReference) => void;
  /** Clears the selection. */
  clear: () => void;
}

export function useMapLocation(
  geocodingProvider: GeocodingProvider,
  current: UseCurrentLocationResult,
): UseMapLocationResult {
  const [selected, setSelected] = useState<LocationReference | null>(null);
  const [labeling, setLabeling] = useState(false);

  const selectFromMap = useCallback(
    async (coordinate: Coordinate): Promise<void> => {
      setLabeling(true);
      let label: string | undefined;
      try {
        const reference = await geocodingProvider.reverseGeocode(coordinate);
        label = reference?.label;
      } catch {
        // Labeling is best-effort: the coordinate remains usable without it.
        label = undefined;
      } finally {
        setLabeling(false);
      }
      setSelected({
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        ...(label ? { label } : {}),
      });
    },
    [geocodingProvider],
  );

  const selectFromSearch = useCallback((location: LocationReference) => {
    setSelected(location);
  }, []);

  const clear = useCallback(() => {
    setSelected(null);
  }, []);

  return {
    selected,
    labeling,
    current,
    selectFromMap,
    selectFromSearch,
    clear,
  };
}
