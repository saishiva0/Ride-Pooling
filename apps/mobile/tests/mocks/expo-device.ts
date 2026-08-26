/**
 * Fail-closed `expo-device` mock for deterministic tests (Phase 3.23).
 *
 * Tests alias `expo-device` to this file (see `vitest.config.ts`) since the
 * native module cannot run in a plain Node vitest environment. `isDevice:
 * false` matches the app's own guard in `token.ts` (`getExpoPushToken`
 * refuses to request a push token off a physical device) — the fail-closed
 * default for a Node test environment, which is never a real device.
 *
 * This file is test infrastructure ONLY; it is never used by the app at
 * runtime (Metro resolves the real module).
 */
export const isDevice = false;
