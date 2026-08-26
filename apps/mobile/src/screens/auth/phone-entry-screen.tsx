/**
 * Phone entry screen (Phase 3.18 — OD-005 resolved).
 *
 * The first step of the phone + OTP flow. Requests an OTP for a phone; on
 * success the auth navigator advances to the OTP verification screen. The
 * response is intentionally generic — the user never learns whether the phone
 * is already registered (no enumeration).
 *
 * No credentials/tokens are handled here: the screen only calls
 * `useAuth().requestOtp` and observes state.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { mobileErrorMessage, type MobileError } from '../../api/errors';
import { Screen } from '../../components/screen';
import { useAsync } from '../../hooks/use-async';
import { useAuth } from '../../auth/auth-provider';
import type { AuthNavigation } from '../../navigation/auth-navigator';
import { colors, spacing, typography } from '../../theme';

export interface PhoneEntryScreenProps {
  navigation: AuthNavigation;
  /** A pending authentication error (from the auth state), or null. */
  authError: MobileError | null;
}

export function PhoneEntryScreen({
  navigation,
  authError,
}: PhoneEntryScreenProps) {
  const { requestOtp } = useAuth();
  const [phone, setPhone] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const pendingPhone = useRef<string | null>(null);

  const { state, run } = useAsync(async () => {
    const target = pendingPhone.current;
    if (target === null) {
      return;
    }
    await requestOtp(target);
  });

  useEffect(() => {
    if (state.status === 'success' && pendingPhone.current !== null) {
      navigation.proceedToOtp(pendingPhone.current);
    }
  }, [state.status, navigation]);

  const handleSendOtp = () => {
    const trimmed = phone.trim();
    if (trimmed === '') {
      setInputError('Enter your phone number.');
      return;
    }
    setInputError(null);
    pendingPhone.current = trimmed;
    void run();
  };

  const isLoading = state.status === 'loading';

  return (
    <Screen>
      <Text style={styles.title}>RidePool</Text>
      <Text style={styles.subtitle}>
        Enter your phone number to receive a one-time code.
      </Text>
      <TextInput
        accessibilityLabel="Phone number"
        placeholder="Phone number"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={(value) => {
          setPhone(value);
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
        accessibilityLabel="Send OTP"
        accessibilityState={{ disabled: isLoading }}
        disabled={isLoading}
        onPress={handleSendOtp}
        style={styles.button}
      >
        <Text style={styles.buttonLabel}>
          {isLoading ? 'Sending…' : 'Send OTP'}
        </Text>
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
  error: {
    ...typography.caption,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
});
