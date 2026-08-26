/**
 * LocationPicker — pick a place via search, map tap, or current location
 * (Phase 3.20 — GOOGLE MAPS & LOCATION INTEGRATION).
 *
 * Composes the map (`RidePoolMap`), the forward-geocoding search
 * (`LocationSearch`), and the current-location flow (`useCurrentLocation`)
 * behind the provider-neutral ports. The picked coordinate is reverse-geocoded
 * into a `LocationReference` label when possible and confirmed to the caller.
 *
 * Every provider is injectable and fails closed: with no Maps provider the
 * map renders its placeholder and search is disabled; with no device-location
 * provider the "Use my location" action shows the normalized message. Manual
 * map-tap selection always works.
 */
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mobileErrorMessage, toMobileError } from '../api/errors';
import { useCurrentLocation } from '../hooks/use-current-location';
import {
  failClosedGeocodingProvider,
  type GeocodingProvider,
} from '../location/geocoding';
import {
  unavailableLocationClient,
  type LocationClient,
} from '../location/location-client';
import { formatLocationReference } from '../location/coordinate';
import type { Coordinate, LocationReference } from '../location/location.types';
import { locationPermissionMessage } from '../location/permission';
import { colors, spacing, typography } from '../theme';
import { LocationSearch } from './location-search';
import { RidePoolMap } from './ride-pool-map';

export interface LocationPickerProps {
  /** Short label, e.g. 'Pickup' or 'Destination'. */
  title: string;
  /** The currently selected location, if any. */
  value?: LocationReference | null;
  /** Called with the confirmed location. */
  onConfirm: (location: LocationReference) => void;
  /** Called to dismiss the picker. */
  onCancel: () => void;
  /** Injectable geocoding provider (defaults to fail-closed). */
  geocodingProvider?: GeocodingProvider;
  /** Injectable device-location client (defaults to fail-closed). */
  locationClient?: LocationClient;
}

export function LocationPicker({
  title,
  value,
  onConfirm,
  onCancel,
  geocodingProvider = failClosedGeocodingProvider,
  locationClient = unavailableLocationClient,
}: LocationPickerProps) {
  const [selected, setSelected] = useState<Coordinate | null>(
    value ? { latitude: value.latitude, longitude: value.longitude } : null,
  );
  const [label, setLabel] = useState<string | null>(value?.label ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reverseError, setReverseError] = useState<string | null>(null);

  const { permission, requestPermission, getCurrentLocation } =
    useCurrentLocation(locationClient);

  const handleMapSelect = useCallback(
    async (coordinate: Coordinate) => {
      setSelected(coordinate);
      setReverseError(null);
      try {
        const reference = await geocodingProvider.reverseGeocode(coordinate);
        setLabel(reference?.label ?? null);
      } catch (err) {
        setReverseError(mobileErrorMessage(toMobileError(err)));
        setLabel(null);
      }
    },
    [geocodingProvider],
  );

  const handleSearchSelect = useCallback((location: LocationReference) => {
    setSelected({ latitude: location.latitude, longitude: location.longitude });
    setLabel(location.label ?? null);
    setReverseError(null);
  }, []);

  const handleUseCurrentLocation = async () => {
    setNotice(null);
    let status = permission;
    if (status !== 'granted') {
      status = await requestPermission();
    }
    if (status !== 'granted') {
      setNotice(locationPermissionMessage(status));
      return;
    }
    try {
      const coordinate = await getCurrentLocation();
      if (coordinate !== null) {
        await handleMapSelect(coordinate);
      }
    } catch (err) {
      setNotice(mobileErrorMessage(toMobileError(err)));
    }
  };

  const confirmDisabled = selected === null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>

      <LocationSearch
        geocodingProvider={geocodingProvider}
        onSelect={handleSearchSelect}
      />

      <RidePoolMap
        initialCoordinate={selected ?? value ?? undefined}
        selectedCoordinate={selected ?? undefined}
        onLocationSelected={handleMapSelect}
        unavailable={geocodingProvider.id === 'fail-closed'}
        accessibilityLabel={`${title} map`}
        style={styles.map}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Use my current location"
        onPress={handleUseCurrentLocation}
        style={styles.currentButton}
      >
        <Text style={styles.currentLabel}>Use my current location</Text>
      </Pressable>
      {notice !== null && <Text style={styles.notice}>{notice}</Text>}
      {reverseError !== null && (
        <Text style={styles.notice}>{reverseError}</Text>
      )}

      <Text
        style={styles.selected}
        accessibilityLabel="Selected location label"
      >
        {selected !== null
          ? (label ?? formatLocationReference(selected))
          : 'No location selected yet. Tap the map or search.'}
      </Text>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onCancel}
          style={styles.cancelButton}
        >
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Confirm ${title.toLowerCase()}`}
          disabled={confirmDisabled}
          onPress={() => {
            if (selected !== null) {
              onConfirm({
                latitude: selected.latitude,
                longitude: selected.longitude,
                ...(label !== null ? { label } : {}),
              });
            }
          }}
          style={[
            styles.confirmButton,
            confirmDisabled ? styles.buttonDisabled : null,
          ]}
        >
          <Text style={styles.confirmLabel}>Confirm {title.toLowerCase()}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  map: {
    height: 200,
    marginBottom: spacing.sm,
  },
  currentButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.accent,
    marginBottom: spacing.sm,
  },
  currentLabel: {
    color: colors.accent,
    fontWeight: '600',
  },
  notice: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  selected: {
    ...typography.caption,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  cancelButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 4,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelLabel: {
    color: colors.textSecondary,
  },
  confirmButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  buttonDisabled: {
    backgroundColor: colors.border,
  },
  confirmLabel: {
    color: colors.background,
    fontWeight: '600',
  },
});
