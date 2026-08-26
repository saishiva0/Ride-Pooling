/**
 * Report user screen (Phase 3.24 — Reporting & Blocking).
 *
 * Lets a ride co-participant file a report against another ride
 * co-participant (POST /api/v1/reports). Reachable only from a context that
 * already knows the target is a ride co-participant (the ride details
 * screen) — this is never a generic "report any user" flow
 * (`docs/planning/phases/phase-3-24.md` §5, §8 — DECIDED scoping).
 *
 * The backend is authoritative on eligibility and enforces: the
 * ride-co-participant scope (403 otherwise), self-report rejection (400),
 * and the 5-per-rolling-24h rate limit (429). This screen does not
 * duplicate those rules — it surfaces whatever the backend decides through
 * the shared normalized `MobileError` model (`ErrorView` /
 * `mobileErrorMessage`), exactly like every other screen in this app.
 *
 * Reasons come from the real backend `ReportReason` enum
 * (`REPORT_REASONS`, `src/safety/types.ts`) — no reason is invented here.
 *
 * Identity: only the target id is sent — the backend derives the actor
 * (reporter) from the API client's auth headers (Phase 3.14).
 */
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { ErrorView } from '../../components/error-view';
import { LoadingView } from '../../components/loading-view';
import { useAsync } from '../../hooks/use-async';
import type { AppNavigation } from '../../navigation/app-navigator';
import type { SafetyApi } from '../../safety/api';
import { REPORT_REASONS, type ReportReasonValue } from '../../safety/types';
import { colors, spacing, typography } from '../../theme';

export interface ReportUserScreenProps {
  navigation: AppNavigation;
  targetUserId: string;
  targetUserName: string;
  /** The ride this report relates to, when known. Optional per the backend
   * contract (`POST /api/v1/reports` accepts `rideId` as optional). */
  rideId?: string;
  safetyApi: SafetyApi;
}

export function ReportUserScreen({
  targetUserId,
  targetUserName,
  rideId,
  safetyApi,
}: ReportUserScreenProps) {
  const [reason, setReason] = useState<ReportReasonValue | null>(null);
  const [detail, setDetail] = useState('');

  const submitOperation = async () => {
    if (reason === null) {
      // Unreachable: the submit action is disabled without a reason.
      throw new Error('A reason is required');
    }
    return safetyApi.createReport({
      reportedUserId: targetUserId,
      reason,
      detail: detail.trim().length > 0 ? detail.trim() : undefined,
      rideId,
    });
  };
  const { state, run } = useAsync(submitOperation);

  const submitted = state.status === 'success';

  const handleSubmit = () => {
    if (reason === null) {
      return;
    }
    void run();
  };

  return (
    <ScrollView>
      <Text style={styles.title}>Report {targetUserName}</Text>
      <Text style={styles.note}>
        This creates a record for RidePool to review. {targetUserName} is never
        told who filed the report or that a report was filed.
      </Text>

      {!submitted && (
        <>
          <Text style={styles.section}>Reason</Text>
          {REPORT_REASONS.map((option) => {
            const selected = reason === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityLabel={`Reason: ${option.label}`}
                accessibilityState={{ selected }}
                onPress={() => setReason(option.value)}
                style={[
                  styles.reasonOption,
                  selected ? styles.reasonOptionSelected : null,
                ]}
              >
                <Text
                  style={[
                    styles.reasonLabel,
                    selected ? styles.reasonLabelSelected : null,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}

          <Text style={styles.section}>Details (optional)</Text>
          <TextInput
            accessibilityLabel="Report details"
            value={detail}
            onChangeText={setDetail}
            placeholder="Add any details that would help (optional)"
            multiline
            style={styles.input}
          />

          {state.status === 'error' && <ErrorView error={state.error} />}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Submit report"
            onPress={handleSubmit}
            disabled={reason === null || state.status === 'loading'}
            style={[
              styles.submitButton,
              reason === null ? styles.submitButtonDisabled : null,
            ]}
          >
            {state.status === 'loading' ? (
              <LoadingView label="Submitting…" />
            ) : (
              <Text style={styles.submitLabel}>Submit report</Text>
            )}
          </Pressable>
        </>
      )}

      {submitted && (
        <Text style={styles.confirmation}>
          Report submitted. Thank you for helping keep RidePool safe.
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
  section: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  reasonOption: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xs,
  },
  reasonOptionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  reasonLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
  reasonLabelSelected: {
    color: colors.accent,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    padding: spacing.sm,
    minHeight: 80,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  submitButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.danger,
    marginTop: spacing.sm,
  },
  submitButtonDisabled: {
    backgroundColor: colors.surface,
  },
  submitLabel: {
    color: colors.background,
    fontWeight: '600',
  },
  confirmation: {
    ...typography.body,
    color: colors.success,
    marginTop: spacing.lg,
  },
});
