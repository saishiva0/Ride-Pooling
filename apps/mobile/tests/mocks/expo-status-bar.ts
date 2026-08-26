/**
 * Minimal `expo-status-bar` mock for deterministic render tests (Phase 3.13).
 *
 * The real component talks to the native status bar; in tests it renders
 * nothing. Test infrastructure only — the app at runtime uses the real
 * module (aliased only under vitest, see `vitest.config.ts`).
 */
export function StatusBar() {
  return null;
}
