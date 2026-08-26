/**
 * Rides home / discovery screen (Phase 3.15 — MOBILE RIDE PARTICIPANT FLOW;
 * Phase 3.16 — current-location integration; Phase 3.20 — map context).
 *
 * The participant's entry point: enter a pickup point (or use the device's
 * current location when available and permitted) and list the eligible rides
 * near it (GET /api/v1/rides/discover).
 *
 * Phase 3.16 adds current-location capability through the provider-neutral
 * `LocationClient` boundary (never Expo Location / native APIs directly).
 * Location is an ENHANCEMENT, not a dependency:
 *   - permission granted → current location populates the coordinate fields
 *   - permission denied / location unavailable → a clear message is shown and
 *     the manual coordinate flow keeps working exactly as before
 * Location NEVER triggers discovery automatically; the user still presses
 * "Find rides" (no hidden network calls, no background location).
 *
 * Phase 3.20 adds a map context through the provider-neutral
 * `GeocodingProvider` boundary (OD-007 → Google Maps): tapping the map selects
 * a pickup point and, after discovery, the pickup points of the found rides are
 * shown as markers. With no Maps provider configured the map renders an
 * explanatory placeholder (fail closed) and the manual flow is unchanged.
 *
 * Matching (POST /api/v1/rides/match) is intentionally NOT wired into this
 * screen: it requires the OD-004 `MatchingConfiguration` thresholds, which
 * are PRODUCT DECISION REQUIRED and never defaulted (see `ride/api.ts`).
 *
 * Identity: none is read or sent — discovery is location-based.
 */
import { useCallback, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { mobileErrorMessage } from '../../api/errors';
import { EmptyView } from '../../components/empty-view';
import { ErrorView } from '../../components/error-view';
import { LoadingView } from '../../components/loading-view';
import { RideCard } from '../../components/ride-card';
import { RidePoolMap } from '../../components/ride-pool-map';
import { useAsync } from '../../hooks/use-async';
import { useCurrentLocation } from '../../hooks/use-current-location';
import { useMapLocation } from '../../hooks/use-map-location';
import {
  locationAcquisitionMessage,
  isLocationSuccess,
  isLocationError,
} from '../../location/location-state';
import {
  unavailableLocationClient,
  type LocationClient,
} from '../../location/location-client';
import {
  failClosedGeocodingProvider,
  type GeocodingProvider,
} from '../../location/geocoding';
import { locationPermissionMessage } from '../../location/permission';
import type { AppNavigation } from '../../navigation/app-navigator';
import { ROUTES } from '../../navigation/routes';
import { isSuccess } from '../../state/async';
import {
  parseDiscoveryForm,
  type DiscoveryInput,
  type DiscoveryFormValues,
} from '../../ride/validation';
import type { RideApi } from '../../ride/api';
import type { RideSummary } from '../../ride/types';
import { colors, spacing, typography } from '../../theme';

export interface RidesHomeScreenProps {
  navigation: AppNavigation;
  rideApi: RideApi;
  /** Injectable device-location client (defaults to the fail-closed
   * `unavailableLocationClient`); tests inject fakes. */
  locationClient?: LocationClient;
  /** Injectable geocoding provider (defaults to the fail-closed provider);
   * tests inject fakes. Phase 3.20 map context. */
  geocodingProvider?: GeocodingProvider;
}

const INITIAL_FORM: DiscoveryFormValues = {
  latitude: '',
  longitude: '',
  radiusKm: '',
};

export function RidesHomeScreen({
  navigation,
  rideApi,
  locationClient = unavailableLocationClient,
  geocodingProvider = failClosedGeocodingProvider,
}: RidesHomeScreenProps) {
  const [form, setForm] = useState<DiscoveryFormValues>(INITIAL_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);

  const currentLocation = useCurrentLocation(locationClient);
  const {
    permission,
    state: locationState,
    requestPermission,
    getCurrentLocation,
  } = currentLocation;

  const { selectFromMap, selected } = useMapLocation(
    geocodingProvider,
    currentLocation,
  );

  const inputRef = useRef<DiscoveryInput | null>(null);
  const operation = useCallback(async () => {
    const input = inputRef.current;
    if (input === null) {
      return [];
    }
    return rideApi.discoverRides(input);
  }, [rideApi]);
  const { state, run } = useAsync(operation);

  const setField = (field: keyof DiscoveryFormValues, value: string) => {
    if (field === 'latitude' || field === 'longitude') {
      setLocationNotice(null);
    }
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  /** Map tap: select the point AND populate the coordinate form fields so
   * discovery uses the tapped location. */
  const handleMapSelect = async (coordinate: {
    latitude: number;
    longitude: number;
  }) => {
    setLocationNotice(null);
    setForm((prev) => ({
      ...prev,
      latitude: coordinate.latitude.toString(),
      longitude: coordinate.longitude.toString(),
    }));
    await selectFromMap(coordinate);
  };

  const handleDiscover = () => {
    const parsed = parseDiscoveryForm(form);
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }
    setFormError(null);
    inputRef.current = parsed.value;
    void run();
  };

  /** Requests permission (if needed) then acquires the current coordinate and
   * populates the form. Manual coordinates remain the always-available path:
   * denial/unavailability only shows a message, never blocks discovery. */
  const handleUseLocation = async () => {
    setLocationNotice(null);
    let status = permission;
    if (status !== 'granted') {
      status = await requestPermission();
    }
    if (status !== 'granted') {
      setLocationNotice(locationPermissionMessage(status));
      return;
    }
    const coordinate = await getCurrentLocation();
    if (coordinate === null) {
      // The acquisition error is rendered from locationState.
      return;
    }
    setForm((prev) => ({
      ...prev,
      latitude: coordinate.latitude.toString(),
      longitude: coordinate.longitude.toString(),
    }));
    setLocationNotice('Current location added to the form.');
  };

  const rides = isSuccess(state) ? state.data : [];
  const acquisitionMessage = locationAcquisitionMessage(locationState);
  const locationMessage: string | null =
    acquisitionMessage ??
    (isLocationError(locationState)
      ? mobileErrorMessage(locationState.error)
      : locationNotice !== null
        ? locationNotice
        : locationPermissionMessage(permission));
  const locationAcquired = isLocationSuccess(locationState);

  const pickupCoordinate = selected ?? undefined;
  const markers = rides.map((ride: RideSummary) => ({
    id: ride.id,
    coordinate: {
      latitude: ride.pickupLocation.latitude,
      longitude: ride.pickupLocation.longitude,
    },
    kind: 'ride' as const,
    title: ride.creator.name,
    description: ride.pickupLocation.label ?? 'Ride pickup',
    onPress: () => navigation.navigate(ROUTES.RIDE_DETAILS, { ride }),
  }));

  return (
    <ScrollView>
      <Text style={styles.hint}>
        Enter a pickup point to discover rides near you.
      </Text>

      <RidePoolMap
        initialCoordinate={pickupCoordinate}
        selectedCoordinate={pickupCoordinate}
        markers={markers}
        onLocationSelected={handleMapSelect}
        unavailable={geocodingProvider.id === 'fail-closed'}
        accessibilityLabel="Discovery map"
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Use my current location"
        onPress={handleUseLocation}
        style={styles.locationButton}
      >
        {locationAcquired ? (
          <Text style={styles.locationLabel}>Current location added</Text>
        ) : (
          <Text style={styles.locationLabel}>Use my current location</Text>
        )}
      </Pressable>
      {locationMessage !== null && (
        <Text style={styles.locationMessage}>{locationMessage}</Text>
      )}

      <View style={styles.fieldRow}>
        <TextInput
          accessibilityLabel="Latitude"
          placeholder="Latitude"
          value={form.latitude}
          onChangeText={(value) => setField('latitude', value)}
          style={styles.input}
          keyboardType="numeric"
        />
        <TextInput
          accessibilityLabel="Longitude"
          placeholder="Longitude"
          value={form.longitude}
          onChangeText={(value) => setField('longitude', value)}
          style={styles.input}
          keyboardType="numeric"
        />
      </View>
      <View style={styles.fieldRow}>
        <TextInput
          accessibilityLabel="Radius in kilometers"
          placeholder="Radius (km)"
          value={form.radiusKm}
          onChangeText={(value) => setField('radiusKm', value)}
          style={styles.input}
          keyboardType="numeric"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Find rides"
          onPress={handleDiscover}
          style={styles.discoverButton}
        >
          <Text style={styles.discoverLabel}>Find rides</Text>
        </Pressable>
      </View>
      {formError !== null && <Text style={styles.formError}>{formError}</Text>}

      {state.status === 'loading' && <LoadingView label="Discovering rides…" />}
      {state.status === 'error' && (
        <ErrorView error={state.error} onRetry={handleDiscover} />
      )}
      {state.status === 'success' && rides.length === 0 && (
        <EmptyView message="No rides found near this point." />
      )}
      {state.status === 'success' && rides.length > 0 && (
        <View style={styles.results}>
          {rides.map((ride: RideSummary) => (
            <RideCard
              key={ride.id}
              ride={ride}
              onPress={() => navigation.navigate(ROUTES.RIDE_DETAILS, { ride })}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hint: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  fieldRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    padding: spacing.sm,
    marginRight: spacing.sm,
    color: colors.textPrimary,
  },
  discoverButton: {
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  discoverLabel: {
    color: colors.background,
  },
  locationButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.accent,
    marginBottom: spacing.sm,
  },
  locationLabel: {
    color: colors.accent,
    fontWeight: '600',
  },
  locationMessage: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  formError: {
    ...typography.caption,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
  results: {
    marginTop: spacing.sm,
  },
});
