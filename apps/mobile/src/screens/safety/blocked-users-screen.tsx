/**
 * Blocked users screen (Phase 3.24 — Reporting & Blocking).
 *
 * Lists the authenticated user's currently-active blocks
 * (GET /api/v1/blocks/mine) with an Unblock action per entry
 * (DELETE /api/v1/blocks/:blockedUserId — a soft delete on the backend;
 * idempotent, always resolves successfully from the client's perspective).
 *
 * Unblocking does not notify the unblocked user (§16, DECIDED — fully
 * silent) and does not by itself affect any ride already confirmed between
 * the two users.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { mobileErrorMessage, toMobileError } from '../../api/errors';
import { EmptyView } from '../../components/empty-view';
import { ErrorView } from '../../components/error-view';
import { LoadingView } from '../../components/loading-view';
import { useAsync } from '../../hooks/use-async';
import type { AppNavigation } from '../../navigation/app-navigator';
import { formatDateTime } from '../../ride/format';
import type { SafetyApi } from '../../safety/api';
import type { ActiveBlock } from '../../safety/types';
import { colors, spacing, typography } from '../../theme';

export interface BlockedUsersScreenProps {
  navigation: AppNavigation;
  safetyApi: SafetyApi;
}

export function BlockedUsersScreen({ safetyApi }: BlockedUsersScreenProps) {
  const [blocks, setBlocks] = useState<readonly ActiveBlock[] | null>(null);
  const [unblockError, setUnblockError] = useState<string | null>(null);
  const [pendingUnblockId, setPendingUnblockId] = useState<string | null>(null);

  const loadOperation = useCallback(
    async () => safetyApi.listMyBlocks(),
    [safetyApi],
  );
  const { state, run } = useAsync(loadOperation);

  useEffect(() => {
    void run();
  }, [run]);

  useEffect(() => {
    if (state.status === 'success') {
      setBlocks(state.data);
    }
  }, [state]);

  const handleUnblock = async (target: ActiveBlock) => {
    setUnblockError(null);
    setPendingUnblockId(target.blockedUserId);
    try {
      await safetyApi.removeBlock({ blockedUserId: target.blockedUserId });
      setBlocks((prev) =>
        prev === null
          ? prev
          : prev.filter((b) => b.blockedUserId !== target.blockedUserId),
      );
    } catch (err) {
      setUnblockError(mobileErrorMessage(toMobileError(err)));
    } finally {
      setPendingUnblockId(null);
    }
  };

  if (state.status === 'loading' && blocks === null) {
    return <LoadingView label="Loading blocked users…" />;
  }
  if (state.status === 'error' && blocks === null) {
    return <ErrorView error={state.error} onRetry={() => void run()} />;
  }
  if (blocks === null) {
    return <LoadingView label="Loading blocked users…" />;
  }

  return (
    <ScrollView>
      <Text style={styles.note}>
        Users you have blocked. Unblocking does not notify them and does not by
        itself affect any ride you already have confirmed together.
      </Text>

      {unblockError !== null && (
        <Text style={styles.mutationError}>{unblockError}</Text>
      )}

      {blocks.length === 0 && (
        <EmptyView message="You haven't blocked anyone." />
      )}

      {blocks.map((entry) => (
        <View key={entry.blockedUserId} style={styles.card}>
          <Text style={styles.name}>{entry.blockedUserName}</Text>
          <Text style={styles.detail}>
            Blocked {formatDateTime(entry.createdAt)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Unblock ${entry.blockedUserName}`}
            onPress={() => void handleUnblock(entry)}
            disabled={pendingUnblockId === entry.blockedUserId}
            style={styles.unblockButton}
          >
            <Text style={styles.unblockLabel}>
              {pendingUnblockId === entry.blockedUserId
                ? 'Unblocking…'
                : 'Unblock'}
            </Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  note: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  mutationError: {
    ...typography.caption,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  name: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  detail: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  unblockButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.accent,
    alignSelf: 'flex-start',
  },
  unblockLabel: {
    color: colors.background,
  },
});
