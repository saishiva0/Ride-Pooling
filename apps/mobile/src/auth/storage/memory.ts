/**
 * In-memory session storage (test infrastructure + dev fallback).
 *
 * Deterministic and process-local. Used by tests and as a safe fallback when
 * the platform secure store is unavailable; it is NEVER used by the shipped
 * app for persisted sessions (see `secure.ts`).
 */
import type { SessionStorage, StoredSession } from './types';

export function createMemorySessionStorage(
  initial: StoredSession | null = null,
): SessionStorage {
  let current: StoredSession | null = initial;
  return {
    get: async () => current,
    save: async (session) => {
      current = session;
    },
    clear: async () => {
      current = null;
    },
  };
}
