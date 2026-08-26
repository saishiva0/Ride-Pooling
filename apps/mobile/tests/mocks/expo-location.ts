/**
 * Fail-closed `expo-location` mock for deterministic tests (Phase 3.20).
 *
 * The native location module cannot run in a plain Node vitest environment,
 * so tests alias `expo-location` to this file (see `vitest.config.ts`). The
 * default location wiring (`createExpoLocationClient`) reads/writes native
 * state; this mock makes every native call fail, so default wiring settles
 * to the fail-closed behavior the app exhibits when the native module is
 * unavailable.
 *
 * Tests that need real behavior inject their own fake native module through
 * `createExpoLocationClient` — they never depend on this mock. This file is
 * test infrastructure ONLY; it is never used by the app at runtime (Metro
 * resolves the real module).
 */
function unavailable(): never {
  throw new Error(
    'expo-location is unavailable in the test environment (fail closed).',
  );
}

export const Accuracy = {
  Lowest: 1,
  Low: 2,
  Balanced: 3,
  High: 4,
  Highest: 5,
  BestForNavigation: 6,
};

export async function getForegroundPermissionsAsync(): Promise<never> {
  return unavailable();
}

export async function requestForegroundPermissionsAsync(): Promise<never> {
  return unavailable();
}

export async function hasServicesEnabledAsync(): Promise<never> {
  return unavailable();
}

export async function getCurrentPositionAsync(): Promise<never> {
  return unavailable();
}
