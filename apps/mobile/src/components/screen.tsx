/**
 * Screen container (Phase 3.13 — MOBILE FOUNDATION).
 *
 * The single layout wrapper for placeholder/future screens: fills the
 * viewport, applies the background color, respects the safe area (via React
 * Native's built-in `SafeAreaView` — no native module dependency), and
 * applies consistent padding. No business logic — it is a pure layout
 * primitive.
 */
import { SafeAreaView, StyleSheet, View, type ViewProps } from 'react-native';
import { colors, spacing } from '../theme';

export type ScreenProps = ViewProps;

export function Screen({ style, children, ...rest }: ScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={[styles.content, style]} {...rest}>
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    padding: spacing.md,
  },
});
