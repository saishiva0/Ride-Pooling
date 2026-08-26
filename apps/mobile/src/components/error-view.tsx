/**
 * Error state view (Phase 3.15 — MOBILE RIDE PARTICIPANT FLOW).
 *
 * Renders a normalized `MobileError` through `mobileErrorMessage` (never raw
 * transport/server detail) with an optional deterministic retry action.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mobileErrorMessage, type MobileError } from '../api/errors';
import { colors, spacing, typography } from '../theme';

export interface ErrorViewProps {
  error: MobileError;
  /** When provided, renders a "Try again" retry action. */
  onRetry?: () => void;
}

export function ErrorView({ error, onRetry }: ErrorViewProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{mobileErrorMessage(error)}</Text>
      {onRetry !== undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try again"
          onPress={onRetry}
          style={styles.retryButton}
        >
          <Text style={styles.retryLabel}>Try again</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  retryLabel: {
    color: colors.background,
  },
});
