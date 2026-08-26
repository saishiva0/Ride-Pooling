/**
 * Ride History screen (Phase 3.17 — MOBILE RIDE CREATOR FLOW).
 *
 * Lists the authenticated creator's completed rides (COMPLETED status).
 * Reuses GET /api/v1/rides/mine and filters for COMPLETED rides.
 *
 * Identity: none is read or sent — the backend derives it from auth headers.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { EmptyView } from '../../components/empty-view';
import { ErrorView } from '../../components/error-view';
import { LoadingView } from '../../components/loading-view';
import { useAsync } from '../../hooks/use-async';
import type { AppNavigation } from '../../navigation/app-navigator';
import { ROUTES } from '../../navigation/routes';
import { formatDateTime, formatPricePerKm } from '../../ride/format';
import type { RideApi } from '../../ride/api';
import type { CreatorRide } from '../../ride/types';
import { colors, spacing, typography } from '../../theme';

export interface RideHistoryScreenProps {
  navigation: AppNavigation;
  rideApi: RideApi;
}

export function RideHistoryScreen({
  navigation,
  rideApi,
}: RideHistoryScreenProps) {
  const [rides, setRides] = useState<readonly CreatorRide[]>([]);

  const operation = useCallback(async () => rideApi.listMyRides(), [rideApi]);
  const { state, run } = useAsync(operation);

  useEffect(() => {
    if (state.status === 'success') {
      setRides(state.data.filter((r) => r.status === 'COMPLETED'));
    }
  }, [state]);

  useEffect(() => {
    void run();
  }, [run]);

  if (state.status === 'loading') {
    return (
      <ScrollView>
        <LoadingView label="Loading ride history…" />
      </ScrollView>
    );
  }

  if (state.status === 'error') {
    return (
      <ScrollView>
        <ErrorView error={state.error} onRetry={run} />
      </ScrollView>
    );
  }

  if (rides.length === 0) {
    return (
      <ScrollView>
        <EmptyView message="No completed rides yet. Your finished rides will appear here." />
      </ScrollView>
    );
  }

  return (
    <ScrollView>
      <Text style={styles.note}>
        Your completed rides. Tap a ride to view details.
      </Text>
      {rides.map((ride) => (
        <View key={ride.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.route}>
              {formatLocationReference(ride.pickupLocation)} →{' '}
              {formatLocationReference(ride.destinationLocation)}
            </Text>
            <Text style={styles.completedBadge}>
              <Text style={styles.completedBadgeText}>COMPLETED</Text>
            </Text>
          </View>
          <Text style={styles.detail}>
            Departed: {formatDateTime(ride.departureDateTime)}
          </Text>
          <Text style={styles.detail}>Seats: {ride.totalSeats} total</Text>
          <Text style={styles.detail}>
            Price: {formatPricePerKm(ride.pricePerKm)}
          </Text>
          <Text style={styles.detail}>
            Completed: {formatDateTime(ride.updatedAt)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${ride.id}`}
            onPress={() =>
              navigation.navigate(ROUTES.RIDE_DETAILS, {
                ride: {
                  id: ride.id,
                  creator: ride.creator,
                  pickupLocation: ride.pickupLocation,
                  destinationLocation: ride.destinationLocation,
                  departureDateTime: ride.departureDateTime,
                  totalSeats: ride.totalSeats,
                  availableSeats: ride.availableSeats,
                  pricingType: ride.pricingType,
                  pricePerKm: ride.pricePerKm,
                  distanceMeters: 0,
                  status: ride.status,
                },
              })
            }
            style={styles.viewButton}
          >
            <Text style={styles.viewLabel}>View Details</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

function formatLocationReference(
  location: CreatorRide['pickupLocation'],
): string {
  return location.label ?? `${location.latitude}, ${location.longitude}`;
}

const styles = StyleSheet.create({
  note: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  route: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  completedBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 4,
    backgroundColor: colors.success + '20',
  },
  completedBadgeText: {
    color: colors.success,
    fontWeight: '600',
  },
  detail: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  viewButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 4,
    backgroundColor: colors.accent,
    alignSelf: 'flex-start',
  },
  viewLabel: {
    color: colors.background,
  },
});
