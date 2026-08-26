/**
 * Block user screen (Phase 3.24 — Reporting & Blocking).
 *
 * Lets a ride co-participant block another ride co-participant
 * (POST /api/v1/blocks). Reachable only from a context that already knows
 * the target is a ride co-participant (the ride details screen) — never a
 * generic "block any user" flow (`docs/planning/phases/phase-3-24.md` §5,
 * §8 — DECIDED scoping). The backend enforces the co-participant scope
 * (403 otherwise) and self-block rejection (400); this screen surfaces
 * whatever it decides through the shared normalized `MobileError` model.
 *
 * Requires an explicit two-step confirmation before calling the API (press
 * "Block user", then "Confirm block").
 *
 * DECIDED (Product owner decision, 2026-08-21,
 * `docs/planning/phases/phase-3-24.md` §13 item 3): blocking does **not**
 * cancel any existing CONFIRMED ride participation between the two users.
 * This screen must never imply otherwise — the copy below states this
 * explicitly at every stage, and no cancellation action is ever triggered
 * here.
 *
 * Identity: only the target id is sent — the backend derives the actor
 * (blocker) from the API client's auth headers (Phase 3.14).
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { ErrorView } from '../../components/error-view';
import { LoadingView } from '../../components/loading-view';
import { useAsync } from '../../hooks/use-async';
import type { AppNavigation } from '../../navigation/app-navigator';
import type { SafetyApi } from '../../safety/api';
import { colors, spacing, typography } from '../../theme';

export interface BlockUserScreenProps {
  navigation: AppNavigation;
  targetUserId: string;
  targetUserName: string;
  safetyApi: SafetyApi;
}

export function BlockUserScreen({
  targetUserId,
  targetUserName,
  safetyApi,
}: BlockUserScreenProps) {
  const [confirming, setConfirming] = useState(false);

  const blockOperation = async () =>
    safetyApi.createBlock({ blockedUserId: targetUserId });
  const { state, run } = useAsync(blockOperation);

  const blocked = state.status === 'success';

  return (
    <ScrollView>
      <Text style={styles.title}>Block {targetUserName}</Text>

      {!blocked && (
        <>
          <Text style={styles.note}>
            Blocking {targetUserName} stops new ride requests between you and
            hides each other from future discovery and matching. It does{' '}
            <Text style={styles.emphasis}>not</Text> cancel any ride you already
            have confirmed together — use that ride's own cancellation option if
            you want out of it.
          </Text>
          <Text style={styles.note}>
            {targetUserName} is never notified that you blocked them.
          </Text>

          {!confirming && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Block user"
              onPress={() => setConfirming(true)}
              style={styles.blockButton}
            >
              <Text style={styles.blockLabel}>Block user</Text>
            </Pressable>
          )}

          {confirming && (
            <>
              <Text style={styles.confirmPrompt}>
                Are you sure you want to block {targetUserName}? This does not
                cancel any existing confirmed ride between you.
              </Text>
              {state.status === 'error' && <ErrorView error={state.error} />}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Confirm block"
                onPress={() => void run()}
                disabled={state.status === 'loading'}
                style={styles.confirmButton}
              >
                {state.status === 'loading' ? (
                  <LoadingView label="Blocking…" />
                ) : (
                  <Text style={styles.confirmLabel}>Confirm block</Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel block"
                onPress={() => setConfirming(false)}
                disabled={state.status === 'loading'}
                style={styles.cancelButton}
              >
                <Text style={styles.cancelLabel}>Cancel</Text>
              </Pressable>
            </>
          )}
        </>
      )}

      {blocked && (
        <Text style={styles.confirmation}>
          {targetUserName} is now blocked. This does not cancel any existing
          confirmed ride between you — use that ride's own cancellation option
          if you want out of it.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  note: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  emphasis: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  blockButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.danger,
    marginTop: spacing.lg,
  },
  blockLabel: {
    color: colors.background,
    fontWeight: '600',
  },
  confirmPrompt: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  confirmButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.danger,
    marginTop: spacing.sm,
  },
  confirmLabel: {
    color: colors.background,
    fontWeight: '600',
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
  },
  cancelLabel: {
    color: colors.textPrimary,
  },
  confirmation: {
    ...typography.body,
    color: colors.success,
    marginTop: spacing.lg,
  },
});
