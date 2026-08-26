/**
 * RidePool application shell (Phase 3.13 — MOBILE FOUNDATION, §7;
 * Phase 3.18 — OD-005 resolved).
 *
 * Deterministic by construction: the root renders the navigation boundary,
 * which renders the auth flow (phone + OTP, Phase 3.18) or the app shell
 * based purely on session state. The concrete AuthClient is built lazily
 * inside AuthProvider (`createDefaultAuthDependencies`) — secure storage +
 * backend validation — with no credentials in the bundle. All configuration
 * lives in `src/config/`, all boundaries are in `src/` modules; nothing
 * business-related lives in this file.
 */
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/auth/auth-provider';
import { RootNavigator } from './src/navigation/root-navigator';

export default function App() {
  return (
    <AuthProvider>
      <RootNavigator />
      <StatusBar style="auto" />
    </AuthProvider>
  );
}
