/**
 * Restoring-boundary splash screen (Phase 3.14 — §13).
 *
 * Rendered while the session is being restored ('restoring' state).
 * Deterministic by construction: a static splash with no network calls, no
 * authentication content, and no business features. Authenticated content is
 * never shown until identity is established (fail closed).
 */
import { StyleSheet, Text } from 'react-native';
import { Screen } from '../components/screen';
import { colors, spacing, typography } from '../theme';

export function RestoringBoundaryScreen() {
  return (
    <Screen>
      <Text style={styles.title}>RidePool</Text>
      <Text style={styles.subtitle}>Mobile foundation ready</Text>
      <Text style={styles.note}>Restoring session…</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  note: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.lg,
  },
});
