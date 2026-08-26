/**
 * In-memory session storage tests (Phase 3.18).
 *
 * The memory store is the deterministic test/fallback storage: it persists for
 * the process lifetime only and never touches the platform keystore.
 */
import { describe, expect, it } from 'vitest';
import { createMemorySessionStorage } from './memory';
import type { StoredSession } from './types';

const session: StoredSession = {
  token: 'token-1',
  expiresAt: '2026-09-18T10:05:00.000Z',
  userId: 'user-1',
};

describe('createMemorySessionStorage', () => {
  it('starts empty', async () => {
    await expect(createMemorySessionStorage().get()).resolves.toBeNull();
  });

  it('can be seeded with an initial session', async () => {
    const storage = createMemorySessionStorage(session);
    await expect(storage.get()).resolves.toEqual(session);
  });

  it('saves and returns the stored session', async () => {
    const storage = createMemorySessionStorage();
    await storage.save(session);
    await expect(storage.get()).resolves.toEqual(session);
  });

  it('clear removes the stored session', async () => {
    const storage = createMemorySessionStorage(session);
    await storage.clear();
    await expect(storage.get()).resolves.toBeNull();
  });

  it('isolates instances (no shared global state)', async () => {
    const a = createMemorySessionStorage(session);
    const b = createMemorySessionStorage();
    await expect(a.get()).resolves.toEqual(session);
    await expect(b.get()).resolves.toBeNull();
  });
});
