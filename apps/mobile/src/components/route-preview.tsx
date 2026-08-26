/**
 * RoutePreview — compact route summary (Phase 3.20 — GOOGLE MAPS & LOCATION
 * INTEGRATION).
 *
 * Presentational card for a `RouteResult` (distance + duration). Pure and
 * deterministic: the duration formatter is locale-free (HHh MMm / MMm / Xs)
 * so tests can pin exact text. The component never performs routing — the
 * parent supplies the `RouteResult` from the provider-neutral `RoutingProvider`.
 */
import { StyleSheet, Text, View } from 'react-native';
import { formatDistance } from '../ride/format';
import type { RouteResult } from '../location/location.types';
import { colors, spacing, typography } from '../theme';

export interface RoutePreviewProps {
  route: RouteResult;
}

/** Formats a duration in seconds as `1h 23m`, `23m`, or `45s`. */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return '0s';
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

export function RoutePreview({ route }: RoutePreviewProps) {
  return (
    <View
      style={styles.container}
      accessibilityLabel="Route preview"
      accessibilityRole="summary"
    >
      <Text style={styles.label}>Route</Text>
      <View style={styles.row}>
        <Text style={styles.value}>{formatDistance(route.distanceMeters)}</Text>
        <Text style={styles.separator}>·</Text>
        <Text style={styles.value}>
          {formatDuration(route.durationSeconds)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    marginRight: spacing.md,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  value: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  separator: {
    ...typography.caption,
    color: colors.textSecondary,
    marginHorizontal: spacing.sm,
  },
});
