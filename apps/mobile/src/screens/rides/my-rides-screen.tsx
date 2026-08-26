/**
 * My Rides screen (Phase 3.17 — MOBILE RIDE CREATOR FLOW).
 *
 * Lists the authenticated creator's rides with current status.
 * Uses GET /api/v1/rides/mine (backend listCreatorRidesHandler).
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

export interface MyRidesScreenProps {
  navigation: AppNavigation;
  rideApi: RideApi;
}

export function MyRidesScreen({ navigation, rideApi }: MyRidesScreenProps) {
  const [rides, setRides] = useState<readonly CreatorRide[]>([]);

  const operation = useCallback(async () => rideApi.listMyRides(), [rideApi]);
  const { state, run } = useAsync(operation);

  useEffect(() => {
    if (state.status === 'success') {
      setRides(state.data);
    }
  }, [state]);

  useEffect(() => {
    void run();
  }, [run]);

  const statusColor = (status: CreatorRide['status']): string => {
    switch (status) {
      case 'DRAFT':
        return colors.textSecondary;
      case 'PUBLISHED':
      case 'CONFIRMED':
        return colors.accent;
      case 'IN_PROGRESS':
        return colors.warning;
      case 'COMPLETED':
        return colors.success;
      case 'CANCELLED':
      case 'EXPIRED':
        return colors.danger;
      default:
        return colors.textPrimary;
    }
  };

  const isActive = (status: CreatorRide['status']): boolean =>
    status === 'PUBLISHED' ||
    status === 'CONFIRMED' ||
    status === 'IN_PROGRESS';

  const isCompleted = (status: CreatorRide['status']): boolean =>
    status === 'COMPLETED';

  if (state.status === 'loading') {
    return (
      <ScrollView>
        <LoadingView label="Loading your rides…" />
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
        <EmptyView message="No rides yet. Create your first ride to get started." />
      </ScrollView>
    );
  }

  return (
    <ScrollView>
      <Text style={styles.note}>
        Your rides as creator. Tap a ride to view details and take action.
      </Text>
      {rides.map((ride) => (
        <View key={ride.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.route}>
              {formatLocationReference(ride.pickupLocation)} →{' '}
              {formatLocationReference(ride.destinationLocation)}
            </Text>
            <Text
              style={[
                styles.statusBadge,
                { backgroundColor: statusColor(ride.status) + '20' },
              ]}
            >
              <Text
                style={{
                  color: statusColor(ride.status),
                  fontWeight: '600',
                }}
              >
                {ride.status}
              </Text>
            </Text>
          </View>
          <Text style={styles.detail}>
            {formatDateTime(ride.departureDateTime)}
          </Text>
          <Text style={styles.detail}>
            Seats: {ride.availableSeats} of {ride.totalSeats} available
          </Text>
          <Text style={styles.detail}>
            Price: {formatPricePerKm(ride.pricePerKm)}
          </Text>
          <Text style={styles.detail}>
            Created: {formatDateTime(ride.createdAt)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${ride.id}`}
            onPress={() =>
              isActive(ride.status)
                ? navigation.navigate(ROUTES.ACTIVE_RIDE, { rideId: ride.id })
                : isCompleted(ride.status)
                  ? navigation.navigate(ROUTES.RIDE_HISTORY)
                  : navigation.navigate(ROUTES.RIDE_DETAILS, {
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
            <Text style={styles.viewLabel}>
              {isActive(ride.status)
                ? 'Active Ride'
                : isCompleted(ride.status)
                  ? 'View History'
                  : 'View Details'}
            </Text>
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
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 4,
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
