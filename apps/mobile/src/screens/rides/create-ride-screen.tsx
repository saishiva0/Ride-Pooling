/**
 * Create ride screen (Phase 3.17 — MOBILE RIDE CREATOR FLOW; Phase 3.20 —
 * map location pickers).
 *
 * The creator's entry point: fill in pickup, destination, departure date/time,
 * seats, pricing, optional discovery radius, and create a DRAFT ride
 * (POST /api/v1/rides).
 *
 * Phase 3.20 adds `LocationPicker`s (map + search + current location) through
 * the provider-neutral `GeocodingProvider`/`LocationClient` boundaries
 * (OD-007 → Google Maps). Confirming a picker populates the same coordinate
 * form fields the manual flow uses — the manual flow stays fully available.
 *
 * Identity: none is read or sent — the backend derives it from auth headers.
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
import { ErrorView } from '../../components/error-view';
import { LoadingView } from '../../components/loading-view';
import { LocationPicker } from '../../components/location-picker';
import { useAsync } from '../../hooks/use-async';
import {
  failClosedGeocodingProvider,
  type GeocodingProvider,
} from '../../location/geocoding';
import {
  unavailableLocationClient,
  type LocationClient,
} from '../../location/location-client';
import type { AppNavigation } from '../../navigation/app-navigator';
import { ROUTES } from '../../navigation/routes';
import { isSuccess } from '../../state/async';
import {
  parseRideCreationForm,
  type RideCreationFormValues,
  type RideCreationInputParsed,
} from '../../ride/validation';
import type { RideApi } from '../../ride/api';
import { colors, spacing, typography } from '../../theme';

export interface CreateRideScreenProps {
  navigation: AppNavigation;
  rideApi: RideApi;
  /** Injectable geocoding provider (defaults to the fail-closed provider);
   * tests inject fakes. */
  geocodingProvider?: GeocodingProvider;
  /** Injectable device-location client (defaults to the fail-closed
   * `unavailableLocationClient`); tests inject fakes. */
  locationClient?: LocationClient;
}

const INITIAL_FORM: RideCreationFormValues = {
  pickupLatitude: '',
  pickupLongitude: '',
  pickupLabel: '',
  destinationLatitude: '',
  destinationLongitude: '',
  destinationLabel: '',
  departureDateTime: '',
  totalSeats: '1',
  vehicleType: '',
  discoveryRadiusKm: '',
  pricingType: 'STANDARD',
  pricePerKm: '',
  estimatedDistanceKm: '',
};

const PRICING_TYPES = ['STANDARD', 'CUSTOM'] as const;

export function CreateRideScreen({
  navigation,
  rideApi,
  geocodingProvider = failClosedGeocodingProvider,
  locationClient = unavailableLocationClient,
}: CreateRideScreenProps) {
  const [form, setForm] = useState<RideCreationFormValues>(INITIAL_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const inputRef = useRef<RideCreationInputParsed | null>(null);

  const operation = useCallback(async () => {
    const input = inputRef.current;
    if (input === null) {
      throw new Error('No input');
    }
    return rideApi.createRide(input);
  }, [rideApi]);
  const { state, run } = useAsync(operation);

  const setField = (field: keyof RideCreationFormValues, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreate = () => {
    const parsed = parseRideCreationForm(form);
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }
    setFormError(null);
    inputRef.current = parsed.value;
    void run();
  };

  const createdRide = isSuccess(state) ? state.data : null;

  const handlePickupConfirm = (location: {
    latitude: number;
    longitude: number;
    label?: string;
  }) => {
    setForm((prev) => ({
      ...prev,
      pickupLatitude: location.latitude.toString(),
      pickupLongitude: location.longitude.toString(),
      pickupLabel: location.label ?? prev.pickupLabel,
    }));
  };

  const handleDestinationConfirm = (location: {
    latitude: number;
    longitude: number;
    label?: string;
  }) => {
    setForm((prev) => ({
      ...prev,
      destinationLatitude: location.latitude.toString(),
      destinationLongitude: location.longitude.toString(),
      destinationLabel: location.label ?? prev.destinationLabel,
    }));
  };

  return (
    <ScrollView>
      <Text style={styles.hint}>
        Create a new ride. All fields are required unless marked optional.
      </Text>

      <Text style={styles.section}>Pickup</Text>
      <LocationPicker
        title="Pickup"
        value={null}
        onConfirm={handlePickupConfirm}
        onCancel={() => {}}
        geocodingProvider={geocodingProvider}
        locationClient={locationClient}
      />
      <View style={styles.fieldRow}>
        <TextInput
          accessibilityLabel="Pickup latitude"
          placeholder="Latitude (required)"
          value={form.pickupLatitude}
          onChangeText={(value) => setField('pickupLatitude', value)}
          style={styles.input}
          keyboardType="numeric"
        />
        <TextInput
          accessibilityLabel="Pickup longitude"
          placeholder="Longitude (required)"
          value={form.pickupLongitude}
          onChangeText={(value) => setField('pickupLongitude', value)}
          style={styles.input}
          keyboardType="numeric"
        />
      </View>
      <TextInput
        accessibilityLabel="Pickup label"
        placeholder="Label (optional)"
        value={form.pickupLabel}
        onChangeText={(value) => setField('pickupLabel', value)}
        style={styles.input}
      />

      <Text style={styles.section}>Destination</Text>
      <LocationPicker
        title="Destination"
        value={null}
        onConfirm={handleDestinationConfirm}
        onCancel={() => {}}
        geocodingProvider={geocodingProvider}
        locationClient={locationClient}
      />
      <View style={styles.fieldRow}>
        <TextInput
          accessibilityLabel="Destination latitude"
          placeholder="Latitude (required)"
          value={form.destinationLatitude}
          onChangeText={(value) => setField('destinationLatitude', value)}
          style={styles.input}
          keyboardType="numeric"
        />
        <TextInput
          accessibilityLabel="Destination longitude"
          placeholder="Longitude (required)"
          value={form.destinationLongitude}
          onChangeText={(value) => setField('destinationLongitude', value)}
          style={styles.input}
          keyboardType="numeric"
        />
      </View>
      <TextInput
        accessibilityLabel="Destination label"
        placeholder="Label (optional)"
        value={form.destinationLabel}
        onChangeText={(value) => setField('destinationLabel', value)}
        style={styles.input}
      />

      <Text style={styles.section}>Departure</Text>
      <TextInput
        accessibilityLabel="Departure date/time"
        placeholder="ISO 8601 (required), e.g. 2026-08-20T10:00:00Z"
        value={form.departureDateTime}
        onChangeText={(value) => setField('departureDateTime', value)}
        style={styles.input}
      />

      <Text style={styles.section}>Seats & Vehicle</Text>
      <View style={styles.fieldRow}>
        <TextInput
          accessibilityLabel="Total seats"
          placeholder="Seats (required, ≥1)"
          value={form.totalSeats}
          onChangeText={(value) => setField('totalSeats', value)}
          style={styles.input}
          keyboardType="numeric"
        />
        <TextInput
          accessibilityLabel="Vehicle type"
          placeholder="Vehicle type (optional)"
          value={form.vehicleType}
          onChangeText={(value) => setField('vehicleType', value)}
          style={styles.input}
        />
      </View>

      <Text style={styles.section}>Discovery</Text>
      <TextInput
        accessibilityLabel="Discovery radius"
        placeholder="Radius in km (optional)"
        value={form.discoveryRadiusKm}
        onChangeText={(value) => setField('discoveryRadiusKm', value)}
        style={styles.input}
        keyboardType="numeric"
      />

      <Text style={styles.section}>Pricing</Text>
      <View style={styles.fieldRow}>
        <View style={styles.pricingTypeContainer}>
          <Text style={styles.pricingTypeLabel}>Type</Text>
          {PRICING_TYPES.map((type) => (
            <Pressable
              key={type}
              accessibilityRole="button"
              accessibilityLabel={type}
              accessibilityState={{ selected: form.pricingType === type }}
              onPress={() => setField('pricingType', type)}
              style={[
                styles.pricingTypeButton,
                form.pricingType === type
                  ? styles.pricingTypeButtonSelected
                  : null,
              ]}
            >
              <Text
                style={[
                  styles.pricingTypeButtonLabel,
                  form.pricingType === type
                    ? styles.pricingTypeButtonLabelSelected
                    : null,
                ]}
              >
                {type}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <TextInput
        accessibilityLabel="Price per km"
        placeholder="Price per km (required)"
        value={form.pricePerKm}
        onChangeText={(value) => setField('pricePerKm', value)}
        style={styles.input}
        keyboardType="numeric"
      />
      <TextInput
        accessibilityLabel="Estimated distance"
        placeholder="Estimated distance in km (optional)"
        value={form.estimatedDistanceKm}
        onChangeText={(value) => setField('estimatedDistanceKm', value)}
        style={styles.input}
        keyboardType="numeric"
      />

      {formError !== null && <Text style={styles.formError}>{formError}</Text>}

      {state.status === 'loading' && <LoadingView label="Creating ride…" />}
      {state.status === 'error' && (
        <ErrorView error={state.error} onRetry={handleCreate} />
      )}

      {createdRide !== null && (
        <View style={styles.successContainer}>
          <Text style={styles.success}>Ride created in DRAFT status!</Text>
          <Text style={styles.detail}>ID: {createdRide.id}</Text>
          <Text style={styles.detail}>Status: {createdRide.status}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go to My Rides"
            onPress={() => navigation.navigate(ROUTES.MY_RIDES)}
            style={styles.actionButton}
          >
            <Text style={styles.actionButtonLabel}>Go to My Rides</Text>
          </Pressable>
        </View>
      )}

      {state.status === 'idle' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create ride"
          onPress={handleCreate}
          style={styles.createButton}
        >
          <Text style={styles.createLabel}>Create ride (DRAFT)</Text>
        </Pressable>
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
  section: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
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
  pricingTypeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  pricingTypeLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginRight: spacing.sm,
  },
  pricingTypeButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
    marginBottom: spacing.xs,
  },
  pricingTypeButtonSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  pricingTypeButtonLabel: {
    color: colors.textPrimary,
  },
  pricingTypeButtonLabelSelected: {
    color: colors.background,
    fontWeight: '600',
  },
  formError: {
    ...typography.caption,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
  createButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginTop: spacing.md,
  },
  createLabel: {
    color: colors.background,
    fontWeight: '600',
  },
  successContainer: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.success,
  },
  success: {
    ...typography.body,
    fontWeight: '600',
    color: colors.success,
    marginBottom: spacing.sm,
  },
  detail: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  actionButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginTop: spacing.md,
  },
  actionButtonLabel: {
    color: colors.background,
    fontWeight: '600',
  },
});
