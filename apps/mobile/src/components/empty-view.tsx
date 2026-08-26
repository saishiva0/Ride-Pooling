/**
 * Empty state view (Phase 3.15 — MOBILE RIDE PARTICIPANT FLOW).
 *
 * Deterministic placeholder for an empty list/result. Pure presentation.
 */
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme';

export interface EmptyViewProps {
  message: string;
}

export function EmptyView({ message }: EmptyViewProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  message: {
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
