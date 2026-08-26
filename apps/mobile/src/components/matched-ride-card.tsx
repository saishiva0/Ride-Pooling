import { StyleSheet, Text, View } from 'react-native';
import { RideCard } from './ride-card';
import { colors, spacing, typography } from '../theme';
import type { MatchedRide } from '../ride/types';

export interface MatchedRideCardProps {
  matchedRide: MatchedRide;
  onPress: () => void;
}

export function MatchedRideCard({
  matchedRide,
  onPress,
}: MatchedRideCardProps) {
  const { ride, eligible, factors } = matchedRide;

  return (
    <View>
      <RideCard ride={ride} onPress={onPress} />
      {eligible && (
        <View style={styles.factorsContainer}>
          <Text style={styles.factorsHeader}>Why this match?</Text>
          {factors
            .filter((f) => f.eligible)
            .map((factor, _index) => (
              <Text key={factor.factor} style={styles.factorLine}>
                {factor.reason}
              </Text>
            ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  factorsContainer: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  factorsHeader: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  factorLine: {
    ...typography.caption,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
});
