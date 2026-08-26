/**
 * Matching screen (Phase 3.19 — MOBILE MATCHING EXPERIENCE).
 *
 * Explicit user action: participant enters pickup, destination, departure
 * time, optional seats → POST /api/v1/rides/match → shows eligible matches
 * with backend-provided factor explanations. Not auto-switched from discovery.
 * Reuses LocationClient ("Use my current location"), and the
 * existing LoadingView/ErrorView/EmptyView components.
 */
import { useCallback, useState } from 'react';
import {
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useCurrentLocation } from '../../hooks/use-current-location';
import {
  unavailableLocationClient,
  type LocationClient,
} from '../../location/location-client';
import { LoadingView } from '../../components/loading-view';
import { ErrorView } from '../../components/error-view';
import { EmptyView } from '../../components/empty-view';
import { MatchedRideCard } from '../../components/matched-ride-card';
import {
  parseMatchingForm,
  type MatchingFormValues,
} from '../../ride/validation';
import { useAuth } from '../../auth/auth-provider';
import type { AsyncState } from '../../state/async';
import type { MatchedRide } from '../../ride/types';
import { ROUTES } from '../../navigation/routes';
import type { AppNavigation } from '../../navigation/app-navigator';
import { createDefaultRideApi } from '../../navigation/app-navigator';
import { colors, spacing, typography } from '../../theme';
import { MobileError } from '../../api/errors';

export interface MatchingScreenProps {
  navigation: Pick<AppNavigation, 'navigate'>;
  /** Injectable device-location client (defaults to the fail-closed
   * `unavailableLocationClient`); tests inject fakes. */
  locationClient?: LocationClient;
}

const INITIAL_FORM: MatchingFormValues = {
  pickupLatitude: '',
  pickupLongitude: '',
  destinationLatitude: '',
  destinationLongitude: '',
  departureDateTime: '',
  requestedSeats: '',
};

export function MatchingScreen({
  navigation,
  locationClient = unavailableLocationClient,
}: MatchingScreenProps) {
  const { headersProvider } = useAuth();
  const { getCurrentLocation } = useCurrentLocation(locationClient);

  const [form, setForm] = useState<MatchingFormValues>(INITIAL_FORM);
  const [asyncState, setAsyncState] = useState<AsyncState<MatchedRide[]>>({
    status: 'idle',
  });

  const api = createDefaultRideApi(headersProvider);

  const executeMatch = useCallback(async () => {
    const parsed = parseMatchingForm(form);
    if (!parsed.ok) {
      setAsyncState({
        status: 'error',
        error: new MobileError('validation', parsed.error),
      });
      return;
    }
    const matches = await api.matchRides(parsed.value);
    setAsyncState({
      status: 'success',
      data: matches,
    });
  }, [form, api]);

  const handleSubmit = () => {
    Keyboard.dismiss();
    setAsyncState({ status: 'loading' });
    executeMatch();
  };

  const handleRetry = () => {
    setAsyncState({ status: 'loading' });
    executeMatch();
  };

  const onPickupLocation = async () => {
    setAsyncState({ status: 'loading' });
    try {
      const coords = await getCurrentLocation();
      if (!coords) {
        setAsyncState({
          status: 'error',
          error: new MobileError(
            'location-unavailable',
            'Location unavailable',
          ),
        });
        return;
      }
      setForm((prev) => ({
        ...prev,
        pickupLatitude: String(coords.latitude),
        pickupLongitude: String(coords.longitude),
      }));
      setAsyncState({ status: 'idle' });
    } catch (error) {
      setAsyncState({
        status: 'error',
        error:
          error instanceof MobileError
            ? error
            : new MobileError('location-unavailable', 'Failed to get location'),
      });
    }
  };

  const eligibleMatches =
    asyncState.status === 'success'
      ? asyncState.data.filter((m) => m.eligible)
      : [];

  const renderForm = () => (
    <View style={styles.form}>
      <Text style={styles.sectionTitle}>Pickup location</Text>
      <View style={styles.coordRow}>
        <View style={styles.inputWrapper}>
          <Text style={styles.inputLabel}>Latitude</Text>
          <TextInput
            style={styles.input}
            placeholder="12.9716"
            value={form.pickupLatitude}
            onChangeText={(value) =>
              setForm((prev) => ({ ...prev, pickupLatitude: value }))
            }
            keyboardType="decimal-pad"
            accessibilityLabel="Pickup latitude"
          />
        </View>
        <View style={styles.inputWrapper}>
          <Text style={styles.inputLabel}>Longitude</Text>
          <TextInput
            style={styles.input}
            placeholder="77.5946"
            value={form.pickupLongitude}
            onChangeText={(value) =>
              setForm((prev) => ({ ...prev, pickupLongitude: value }))
            }
            keyboardType="decimal-pad"
            accessibilityLabel="Pickup longitude"
          />
        </View>
      </View>
      <TouchableOpacity
        style={styles.currentLocationButton}
        onPress={onPickupLocation}
        disabled={asyncState.status === 'loading'}
      >
        <Text style={styles.currentLocationText}>Use my current location</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Destination</Text>
      <View style={styles.coordRow}>
        <View style={styles.inputWrapper}>
          <Text style={styles.inputLabel}>Latitude</Text>
          <TextInput
            style={styles.input}
            placeholder="12.9698"
            value={form.destinationLatitude}
            onChangeText={(value) =>
              setForm((prev) => ({ ...prev, destinationLatitude: value }))
            }
            keyboardType="decimal-pad"
            accessibilityLabel="Destination latitude"
          />
        </View>
        <View style={styles.inputWrapper}>
          <Text style={styles.inputLabel}>Longitude</Text>
          <TextInput
            style={styles.input}
            placeholder="77.7500"
            value={form.destinationLongitude}
            onChangeText={(value) =>
              setForm((prev) => ({ ...prev, destinationLongitude: value }))
            }
            keyboardType="decimal-pad"
            accessibilityLabel="Destination longitude"
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>Departure date/time</Text>
      <TextInput
        style={styles.input}
        placeholder="2026-08-20T10:00:00.000Z"
        value={form.departureDateTime}
        onChangeText={(value) =>
          setForm((prev) => ({ ...prev, departureDateTime: value }))
        }
        accessibilityLabel="Departure date/time (ISO 8601)"
      />

      <Text style={styles.sectionTitle}>Requested seats (optional)</Text>
      <TextInput
        style={styles.input}
        placeholder="1"
        value={form.requestedSeats}
        onChangeText={(value) =>
          setForm((prev) => ({ ...prev, requestedSeats: value }))
        }
        keyboardType="numeric"
        accessibilityLabel="Requested seats"
      />

      <TouchableOpacity
        style={[
          styles.submitButton,
          asyncState.status === 'loading' && styles.submitButtonDisabled,
        ]}
        onPress={handleSubmit}
        disabled={asyncState.status === 'loading'}
      >
        <Text style={styles.submitButtonText}>
          {asyncState.status === 'loading'
            ? 'Finding matches…'
            : 'Find matches'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.title}>Find your match</Text>
        <Text style={styles.subtitle}>
          Enter your journey details to find compatible rides.
        </Text>
      </View>

      {asyncState.status === 'idle' && renderForm()}

      {asyncState.status === 'loading' && (
        <View style={styles.loadingWrapper}>
          <LoadingView label="Matching rides…" />
        </View>
      )}

      {asyncState.status === 'error' && (
        <ErrorView
          error={
            asyncState.error ?? new MobileError('unknown', 'Matching failed')
          }
          onRetry={handleRetry}
        />
      )}

      {asyncState.status === 'success' && (
        <>
          {renderForm()}
          <View style={styles.resultsHeader}>
            <Text style={styles.resultsTitle}>
              {eligibleMatches.length === 0
                ? 'No eligible matches'
                : `${eligibleMatches.length} eligible match${eligibleMatches.length === 1 ? '' : 'es'}`}
            </Text>
          </View>
          {eligibleMatches.length === 0 ? (
            <EmptyView message="No rides matched your criteria." />
          ) : (
            <View style={styles.resultsList}>
              {eligibleMatches.map((matchedRide) => (
                <MatchedRideCard
                  key={matchedRide.ride.id}
                  matchedRide={matchedRide}
                  onPress={() =>
                    navigation.navigate(ROUTES.RIDE_DETAILS, {
                      ride: matchedRide.ride,
                    })
                  }
                />
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    backgroundColor: colors.background,
  },
  header: {
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  form: {
    gap: spacing.lg,
  },
  sectionTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  coordRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  inputWrapper: {
    flex: 1,
    gap: spacing.xs,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  input: {
    ...typography.body,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
  },
  currentLocationButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.accent + '20',
    borderRadius: 8,
  },
  currentLocationText: {
    ...typography.body,
    color: colors.accent,
  },
  submitButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  submitButtonDisabled: {
    backgroundColor: colors.accent + '60',
  },
  submitButtonText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.background,
  },
  loadingWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultsHeader: {
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  resultsTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  resultsList: {
    gap: spacing.md,
  },
});
