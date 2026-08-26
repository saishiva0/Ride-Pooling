/**
 * RootNavigator (Phase 3.13 — MOBILE FOUNDATION, §9; Phase 3.14 — §13;
 * Phase 3.15; Phase 3.18).
 *
 * Selects the boundary to render from the discriminated-union auth state:
 *
 *   restoring            → deterministic restoring/splash boundary
 *   unauthenticated      → auth boundary (phone + OTP flow, Phase 3.18)
 *   authentication-error → auth boundary — fail closed (error surfaced there)
 *   authenticated        → authenticated app boundary (the Phase 3.15
 *                          `AppNavigator` ride shell)
 *
 * Fail-closed and deterministic: authenticated content is never rendered while
 * the session is unresolved or errored. Navigation never depends on the
 * authentication implementation — only on the session state it observes.
 */
import { useAuth } from '../auth/auth-provider';
import { AuthNavigator } from './auth-navigator';
import { RestoringBoundaryScreen } from '../screens/restoring-boundary-screen';
import { AppNavigator } from './app-navigator';

export function RootNavigator() {
  const { state } = useAuth();

  switch (state.status) {
    case 'authenticated':
      return <AppNavigator />;
    case 'restoring':
      return <RestoringBoundaryScreen />;
    case 'unauthenticated':
    case 'authentication-error':
    default:
      return <AuthNavigator />;
  }
}
