/**
 * Secure session storage (Phase 3.18 — OD-005 resolved).
 *
 * Persists the session in the platform keystore/Keychain via
 * `expo-secure-store` — never AsyncStorage, plain files, or globals. Only the
 * bearer token + expiry + user id are stored; no OTP, credentials, or secrets
 * are ever written. A malformed/older payload fails closed as "no session"
 * (`get()` returns null) via `parseStoredSession`.
 */
import * as SecureStore from 'expo-secure-store';
import { parseStoredSession } from './session-validation';
import type { SessionStorage, StoredSession } from './types';

/** Single storage key for the session payload. */
export const SESSION_STORAGE_KEY = 'ridepool.session.v1';

export function createSecureSessionStorage(): SessionStorage {
  return {
    async get(): Promise<StoredSession | null> {
      const raw = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
      if (raw === null) {
        return null;
      }
      try {
        return parseStoredSession(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    async save(session: StoredSession): Promise<void> {
      await SecureStore.setItemAsync(
        SESSION_STORAGE_KEY,
        JSON.stringify(session),
      );
    },
    async clear(): Promise<void> {
      await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
    },
  };
}
