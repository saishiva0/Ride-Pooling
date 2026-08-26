/**
 * AuthNavigator (Phase 3.18 — OD-005 resolved).
 *
 * The public (unauthenticated) boundary for the phone + OTP flow. Renders the
 * phone entry screen, then the OTP verification screen once a phone is
 * submitted. It is framework-free (matches the project's navigation
 * convention) and never handles credentials — it only sequences the two
 * screens and surfaces any authentication error from the auth state.
 */
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/auth-provider';
import { PhoneEntryScreen } from '../screens/auth/phone-entry-screen';
import { OtpVerificationScreen } from '../screens/auth/otp-verification-screen';

export type AuthScreen = { screen: 'phone' } | { screen: 'otp'; phone: string };

export interface AuthNavigation {
  proceedToOtp(phone: string): void;
  goBack(): void;
}

export function AuthNavigator() {
  const { state } = useAuth();
  const [screen, setScreen] = useState<AuthScreen>({ screen: 'phone' });
  const authError =
    state.status === 'authentication-error' ? state.error : null;

  const navigation = useMemo<AuthNavigation>(
    () => ({
      proceedToOtp: (phone) => setScreen({ screen: 'otp', phone }),
      goBack: () => setScreen({ screen: 'phone' }),
    }),
    [],
  );

  if (screen.screen === 'otp') {
    return (
      <OtpVerificationScreen
        phone={screen.phone}
        navigation={navigation}
        authError={authError}
      />
    );
  }
  return <PhoneEntryScreen navigation={navigation} authError={authError} />;
}
