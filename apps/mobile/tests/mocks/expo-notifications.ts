/**
 * Fail-closed `expo-notifications` mock for deterministic tests (Phase 3.23).
 *
 * The native notifications module cannot run in a plain Node vitest
 * environment (importing it for real throws `ReferenceError: __DEV__ is not
 * defined`), so tests alias `expo-notifications` to this file (see
 * `vitest.config.ts`). Every native call throws, so the notifications module
 * settles to the same fail-closed behavior the app exhibits when the native
 * module is unavailable (e.g. web, or a broken install).
 *
 * Tests that need a working notifications flow override specific exports
 * with `vi.spyOn`/`vi.mock` in the test file — they never rely on this mock
 * succeeding. This file is test infrastructure ONLY; it is never used by the
 * app at runtime (Metro resolves the real module).
 */
function unavailable(): never {
  throw new Error(
    'expo-notifications is unavailable in the test environment (fail closed).',
  );
}

export const AndroidImportance = {
  MIN: 1,
  LOW: 2,
  DEFAULT: 3,
  HIGH: 4,
  MAX: 5,
};

export const SchedulableTriggerInputTypes = {
  TIME_INTERVAL: 'timeInterval',
};

export async function getPermissionsAsync(): Promise<never> {
  return unavailable();
}

export async function requestPermissionsAsync(): Promise<never> {
  return unavailable();
}

export async function setNotificationChannelAsync(): Promise<never> {
  return unavailable();
}

export function setNotificationHandler(): never {
  return unavailable();
}

export function addNotificationReceivedListener(): never {
  return unavailable();
}

export function addNotificationResponseReceivedListener(): never {
  return unavailable();
}

export async function getLastNotificationResponseAsync(): Promise<never> {
  return unavailable();
}

export async function scheduleNotificationAsync(): Promise<never> {
  return unavailable();
}

export async function cancelAllScheduledNotificationsAsync(): Promise<never> {
  return unavailable();
}

export async function setBadgeCountAsync(): Promise<never> {
  return unavailable();
}

export async function getExpoPushTokenAsync(): Promise<never> {
  return unavailable();
}
