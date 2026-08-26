/**
 * Ride card (Phase 3.15 — MOBILE RIDE PARTICIPANT FLOW).
 *
 * Presentational summary of one discovered ride. No business logic and no API
 * access — the parent decides what happens on press (typically navigating to
 * ride details). Accessibility: the whole card is a labeled button.
 */
import { Pressable, StyleSheet, Text } from 'react-native';
import {
  asLocationReference,
  formatLocationReference,
} from '../location/coordinate';
import {
  formatDateTime,
  formatDistance,
  formatPricePerKm,
} from '../ride/format';
import type { RideSummary } from '../ride/types';
import { colors, spacing, typography } from '../theme';

export interface RideCardProps {
  ride: RideSummary;
  /** Called when the card is pressed. */
  onPress: () => void;
}

function locationLabel(location: RideSummary['pickupLocation']): string {
  return formatLocationReference(asLocationReference(location));
}

export function RideCard({ ride, onPress }: RideCardProps) {
  const pickup = locationLabel(ride.pickupLocation);
  const destination = locationLabel(ride.destinationLocation);
  const accessibilityLabel =
    `Ride by ${ride.creator.name} from ${pickup} to ${destination}, ` +
    `${ride.availableSeats} seats available, ${formatPricePerKm(ride.pricePerKm)} per kilometer`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.card}
    >
      <Text style={styles.route}>
        {pickup} → {destination}
      </Text>
      <Text style={styles.detail}>
        {formatDateTime(ride.departureDateTime)} · by {ride.creator.name}
      </Text>
      <Text style={styles.detail}>
        {ride.availableSeats} of {ride.totalSeats} seats ·{' '}
        {formatPricePerKm(ride.pricePerKm)} ·{' '}
        {formatDistance(ride.distanceMeters)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  route: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  detail: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});
