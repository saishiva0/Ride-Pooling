/**
 * Fail-closed `expo-secure-store` mock for deterministic tests (Phase 3.18).
 *
 * The native secure store cannot run in a plain Node vitest environment, so
 * tests alias `expo-secure-store` to this file (see `vitest.config.ts`). The
 * default auth wiring (`createSecureSessionStorage`) reads/writes the store;
 * this mock makes every native call throw, so session restore settles to
 * `unauthenticated` deterministically (exactly the fail-closed behavior the
 * app exhibits when the platform store is unavailable).
 *
 * Tests that need real storage inject `createMemorySessionStorage` instead —
 * they never depend on this mock. This file is test infrastructure ONLY; it
 * is never used by the app at runtime (Metro resolves the real module).
 */
function unavailable(): never {
  throw new Error(
    'expo-secure-store is unavailable in the test environment (fail closed).',
  );
}

export async function getItemAsync(): Promise<never> {
  return unavailable();
}

export async function setItemAsync(): Promise<never> {
  return unavailable();
}

export async function deleteItemAsync(): Promise<never> {
  return unavailable();
}
