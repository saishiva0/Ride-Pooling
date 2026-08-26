/**
 * OTP verification screen (Phase 3.18 — OD-005 resolved).
 *
 * The second step of the phone + OTP flow. Verifies the code received for a
 * phone via `useAuth().signIn(phone, otp)`; a successful verification flips
 * the auth state to authenticated and the root navigator swaps to the app
 * boundary automatically. Wrong/expired codes surface the generic normalized
 * message (never whether the phone is registered). "Resend OTP" requests a
 * fresh code (rate-limited server-side).
 */
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';
import {
  mobileErrorMessage,
  toMobileError,
  type MobileError,
} from '../../api/errors';
import { Screen } from '../../components/screen';
import { useAsync } from '../../hooks/use-async';
import { useAuth } from '../../auth/auth-provider';
import { idleAsyncState, type AsyncState } from '../../state/async';
import type { AuthNavigation } from '../../navigation/auth-navigator';
import { colors, spacing, typography } from '../../theme';

export interface OtpVerificationScreenProps {
  /** The phone the OTP was sent to (already validated by the backend). */
  phone: string;
  navigation: AuthNavigation;
  /** A pending authentication error (from the auth state), or null. */
  authError: MobileError | null;
}

export function OtpVerificationScreen({
  phone,
  navigation,
  authError,
}: OtpVerificationScreenProps) {
  const { signIn, requestOtp } = useAuth();
  const [otp, setOtp] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const pending = useRef<{ phone: string; otp: string } | null>(null);
  const [resend, setResend] = useState<AsyncState<void>>(idleAsyncState);

  const { state, run } = useAsync(async () => {
    const target = pending.current;
    if (target === null) {
      return;
    }
    await signIn(target.phone, target.otp);
  });

  const handleVerify = () => {
    const trimmed = otp.trim();
    if (!/^\d+$/.test(trimmed) || trimmed.length < 4 || trimmed.length > 9) {
      setInputError('Enter the code you received.');
      return;
    }
    setInputError(null);
    pending.current = { phone, otp: trimmed };
    void run();
  };

  const handleResend = async () => {
    setResend({ status: 'loading' });
    try {
      await requestOtp(phone);
      setResend({ status: 'success', data: undefined });
    } catch (err) {
      setResend({ status: 'error', error: toMobileError(err) });
    }
  };

  const isVerifying = state.status === 'loading';

  return (
    <Screen>
      <Text style={styles.title}>Enter the code</Text>
      <Text style={styles.subtitle}>We sent a one-time code to {phone}.</Text>
      <TextInput
        accessibilityLabel="OTP"
        placeholder="One-time code"
        keyboardType="number-pad"
        value={otp}
        onChangeText={(value) => {
          setOtp(value);
          if (inputError !== null) {
            setInputError(null);
          }
        }}
        style={styles.input}
      />
      {inputError !== null && <Text style={styles.error}>{inputError}</Text>}
      {state.status === 'error' && (
        <Text style={styles.error}>{mobileErrorMessage(state.error)}</Text>
      )}
      {authError !== null && state.status !== 'error' && (
        <Text style={styles.error}>{mobileErrorMessage(authError)}</Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Verify code"
        accessibilityState={{ disabled: isVerifying }}
        disabled={isVerifying}
        onPress={handleVerify}
        style={styles.button}
      >
        <Text style={styles.buttonLabel}>
          {isVerifying ? 'Verifying…' : 'Verify code'}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Resend OTP"
        accessibilityState={{ disabled: resend.status === 'loading' }}
        disabled={resend.status === 'loading'}
        onPress={() => void handleResend()}
        style={styles.resendButton}
      >
        <Text style={styles.resendLabel}>
          {resend.status === 'loading'
            ? 'Sending…'
            : resend.status === 'success'
              ? 'Code sent'
              : 'Resend OTP'}
        </Text>
      </Pressable>
      {resend.status === 'error' && (
        <Text style={styles.error}>{mobileErrorMessage(resend.error)}</Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Change phone number"
        onPress={navigation.goBack}
        style={styles.backButton}
      >
        <Text style={styles.backLabel}>Change phone number</Text>
      </Pressable>
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
    marginBottom: spacing.lg,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    color: colors.textPrimary,
  },
  button: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginTop: spacing.sm,
  },
  buttonLabel: {
    color: colors.background,
    fontWeight: '600',
  },
  resendButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  resendLabel: {
    color: colors.accent,
    fontWeight: '600',
  },
  backButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  backLabel: {
    color: colors.textSecondary,
  },
  error: {
    ...typography.caption,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
});
