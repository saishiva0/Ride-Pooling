/**
 * Fail-closed `expo-constants` mock for deterministic tests (Phase 3.23).
 *
 * Tests alias `expo-constants` to this file (see `vitest.config.ts`) since
 * the native module cannot run in a plain Node vitest environment. No EAS
 * project id is configured, matching the fail-closed default when `app.json`
 * has not been linked to a real EAS project.
 *
 * This file is test infrastructure ONLY; it is never used by the app at
 * runtime (Metro resolves the real module).
 */
const constants = { expoConfig: null };
export default constants;
