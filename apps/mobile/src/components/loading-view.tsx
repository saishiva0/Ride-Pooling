/**
 * Loading state view (Phase 3.15 — MOBILE RIDE PARTICIPANT FLOW).
 *
 * Deterministic placeholder for an in-flight async operation. Renders an
 * `ActivityIndicator` plus stable text; used inside screens' `AsyncState`
 * rendering. Pure presentation — no state.
 */
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme';

export interface LoadingViewProps {
  /** Human label for what is loading (e.g. "Discovering rides…"). */
  label?: string;
}

export function LoadingView({ label = 'Loading…' }: LoadingViewProps) {
  return (
    <View style={styles.container}>
      <ActivityIndicator accessibilityLabel="loading" />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  label: {
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
});
