/**
 * Stored-session validation (Phase 3.18 — OD-005 resolved).
 *
 * The secure store may hold an outdated, corrupted, or tampered payload
 * (schema drift, partial writes, manual edits). A malformed payload must
 * FAIL CLOSED as "no session" — never crash, never be treated as a session.
 */
import type { StoredSession } from './types';

/** Validates an unknown stored payload; returns null for any malformed shape. */
export function parseStoredSession(value: unknown): StoredSession | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.token !== 'string' || record.token.trim() === '') {
    return null;
  }
  if (typeof record.userId !== 'string' || record.userId.trim() === '') {
    return null;
  }
  if (typeof record.expiresAt !== 'string') {
    return null;
  }
  const time = Date.parse(record.expiresAt);
  if (Number.isNaN(time)) {
    return null;
  }
  return {
    token: record.token,
    expiresAt: record.expiresAt,
    userId: record.userId,
  };
}
