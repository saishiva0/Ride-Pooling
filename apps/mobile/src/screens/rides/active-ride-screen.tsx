/**
 * Active Ride screen (Phase 3.17 — MOBILE RIDE CREATOR FLOW).
 *
 * For rides in PUBLISHED, CONFIRMED, or IN_PROGRESS state.
 * Creator can start (→ IN_PROGRESS) and complete (→ COMPLETED) the ride.
 * Uses POST /api/v1/rides/:rideId/start and POST /api/v1/rides/:rideId/complete.
 *
 * Identity: none is read or sent — the backend derives it from auth headers.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { ErrorView } from '../../components/error-view';
import { LoadingView } from '../../components/loading-view';
import { useAsync } from '../../hooks/use-async';
import type { AppNavigation } from '../../navigation/app-navigator';
import { ROUTES } from '../../navigation/routes';
import { formatDateTime, formatPricePerKm } from '../../ride/format';
import type { RideApi } from '../../ride/api';
import type { CreatorRide, StartedRide, CompletedRide } from '../../ride/types';
import { colors, spacing, typography } from '../../theme';

export interface ActiveRideScreenProps {
  navigation: AppNavigation;
  rideId: string;
  rideApi: RideApi;
}

const STARTABLE_STATUSES = ['PUBLISHED', 'CONFIRMED'] as const;
const COMPLETABLE_STATUSES = ['IN_PROGRESS'] as const;

export function ActiveRideScreen({
  navigation,
  rideId,
  rideApi,
}: ActiveRideScreenProps) {
  const [ride, setRide] = useState<CreatorRide | null>(null);
  const [startedRide, setStartedRide] = useState<StartedRide | null>(null);
  const [completedRide, setCompletedRide] = useState<CompletedRide | null>(
    null,
  );

  const loadRide = useCallback(
    async () => rideApi.getRideDetail(rideId),
    [rideId, rideApi],
  );
  const { state: loadState, run: runLoad } = useAsync(loadRide);

  const startOperation = useCallback(
    async () => rideApi.startRide({ rideId }),
    [rideId, rideApi],
  );
  const { state: startState, run: runStart } = useAsync(startOperation);

  const completeOperation = useCallback(
    async () => rideApi.completeRide({ rideId }),
    [rideId, rideApi],
  );
  const { state: completeState, run: runComplete } =
    useAsync(completeOperation);

  useEffect(() => {
    if (loadState.status === 'success') {
      setRide(loadState.data);
    }
  }, [loadState]);

  useEffect(() => {
    if (startState.status === 'success') {
      setStartedRide(startState.data);
      void runLoad();
    }
  }, [startState, runLoad]);

  useEffect(() => {
    if (completeState.status === 'success') {
      setCompletedRide(completeState.data);
      void runLoad();
    }
  }, [completeState, runLoad]);

  useEffect(() => {
    void runLoad();
  }, [runLoad]);

  const canStart =
    ride !== null &&
    STARTABLE_STATUSES.includes(
      ride.status as (typeof STARTABLE_STATUSES)[number],
    );
  const canComplete =
    ride !== null &&
    COMPLETABLE_STATUSES.includes(
      ride.status as (typeof COMPLETABLE_STATUSES)[number],
    );

  if (loadState.status === 'loading') {
    return (
      <ScrollView>
        <LoadingView label="Loading active ride…" />
      </ScrollView>
    );
  }

  if (loadState.status === 'error') {
    return (
      <ScrollView>
        <ErrorView error={loadState.error} onRetry={runLoad} />
      </ScrollView>
    );
  }

  if (ride === null) {
    return (
      <ScrollView>
        <Text style={styles.error}>Ride not found</Text>
      </ScrollView>
    );
  }

  const isInProgress = ride.status === 'IN_PROGRESS';
  const isCompleted = ride.status === 'COMPLETED';

  return (
    <ScrollView>
      <Text style={styles.route}>
        {formatLocationReference(ride.pickupLocation)} →{' '}
        {formatLocationReference(ride.destinationLocation)}
      </Text>
      <Text style={styles.detail}>
        Departure: {formatDateTime(ride.departureDateTime)}
      </Text>
      <Text style={styles.detail}>Creator: {ride.creator.name}</Text>
      <Text style={styles.detail}>
        Seats: {ride.availableSeats} of {ride.totalSeats} available
      </Text>
      <Text style={styles.detail}>
        Price: {formatPricePerKm(ride.pricePerKm)}
      </Text>
      <Text style={styles.detail}>Status: {ride.status}</Text>

      {startedRide !== null && (
        <Text style={styles.confirmation}>
          Ride started at {formatDateTime(startedRide.startedAt)}. Status:{' '}
          {startedRide.status}
        </Text>
      )}

      {completedRide !== null && (
        <Text style={styles.confirmation}>
          Ride completed at {formatDateTime(completedRide.completedAt)}. Status:{' '}
          {completedRide.status}
        </Text>
      )}

      {isCompleted && (
        <Text style={styles.confirmation}>
          This ride is completed. View it in Ride History.
        </Text>
      )}

      {canStart && !isInProgress && !isCompleted && (
        <>
          <Text style={styles.section}>Start Ride</Text>
          {startState.status === 'error' && (
            <ErrorView error={startState.error} />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start ride"
            onPress={() => void runStart()}
            style={styles.startButton}
          >
            {startState.status === 'loading' ? (
              <LoadingView label="Starting…" />
            ) : (
              <Text style={styles.startLabel}>Start ride</Text>
            )}
          </Pressable>
        </>
      )}

      {canComplete && !isCompleted && (
        <>
          <Text style={styles.section}>Complete Ride</Text>
          {completeState.status === 'error' && (
            <ErrorView error={completeState.error} />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Complete ride"
            onPress={() => void runComplete()}
            style={styles.completeButton}
          >
            {completeState.status === 'loading' ? (
              <LoadingView label="Completing…" />
            ) : (
              <Text style={styles.completeLabel}>Complete ride</Text>
            )}
          </Pressable>
        </>
      )}

      {!canStart && !canComplete && !isInProgress && !isCompleted && (
        <Text style={styles.note}>
          No actions available for this ride in its current state.
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to My Rides"
        onPress={() => navigation.navigate(ROUTES.MY_RIDES)}
        style={styles.backButton}
      >
        <Text style={styles.backLabel}>Back to My Rides</Text>
      </Pressable>
    </ScrollView>
  );
}

function formatLocationReference(
  location: CreatorRide['pickupLocation'],
): string {
  return location.label ?? `${location.latitude}, ${location.longitude}`;
}

const styles = StyleSheet.create({
  route: {
    ...typography.title,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  detail: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  section: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  confirmation: {
    ...typography.body,
    color: colors.success,
    marginTop: spacing.lg,
  },
  note: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.lg,
  },
  startButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginTop: spacing.sm,
  },
  startLabel: {
    color: colors.background,
    fontWeight: '600',
  },
  completeButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.success,
    marginTop: spacing.sm,
  },
  completeLabel: {
    color: colors.background,
    fontWeight: '600',
  },
  backButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.lg,
  },
  backLabel: {
    color: colors.accent,
    fontWeight: '600',
  },
  error: {
    ...typography.body,
    color: colors.danger,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});
