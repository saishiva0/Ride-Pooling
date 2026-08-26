import { describe, expect, it, vi } from 'vitest';
import {
  createStoredAuthHeadersProvider,
  noAuthHeadersProvider,
} from './auth-headers';
import { createMemorySessionStorage } from './storage/memory';
import type { SessionStorage } from './storage/types';

const futureExpiry = new Date(
  Date.now() + 30 * 24 * 60 * 60 * 1000,
).toISOString();

describe('auth headers provider (API credential seam)', () => {
  it('fails closed: the default provider attaches no auth headers', async () => {
    await expect(noAuthHeadersProvider.getAuthHeaders()).resolves.toBeNull();
  });

  it('never invents a header or a token', async () => {
    const headers = await noAuthHeadersProvider.getAuthHeaders();
    expect(headers).toBeNull();
  });

  it('is provider-neutral: any session provider can supply arbitrary headers', async () => {
    const provider = {
      async getAuthHeaders() {
        return { Authorization: 'Bearer <future-token>' };
      },
    };
    await expect(provider.getAuthHeaders()).resolves.toEqual({
      Authorization: 'Bearer <future-token>',
    });
  });

  it('resolves null when a session-aware provider has no session', async () => {
    const provider = {
      async getAuthHeaders() {
        return null;
      },
    };
    await expect(provider.getAuthHeaders()).resolves.toBeNull();
  });
});

describe('createStoredAuthHeadersProvider', () => {
  it('attaches the bearer token when a valid stored session exists', async () => {
    const storage: SessionStorage = createMemorySessionStorage({
      token: 'token-1',
      expiresAt: futureExpiry,
      userId: 'user-1',
    });
    const provider = createStoredAuthHeadersProvider(storage);

    await expect(provider.getAuthHeaders()).resolves.toEqual({
      Authorization: 'Bearer token-1',
    });
  });

  it('returns null when nothing is stored (fail closed)', async () => {
    const provider = createStoredAuthHeadersProvider(
      createMemorySessionStorage(),
    );

    await expect(provider.getAuthHeaders()).resolves.toBeNull();
  });

  it('clears and returns null for an expired stored session', async () => {
    const storage: SessionStorage = createMemorySessionStorage({
      token: 'token-1',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      userId: 'user-1',
    });
    const provider = createStoredAuthHeadersProvider(storage);

    await expect(provider.getAuthHeaders()).resolves.toBeNull();
    await expect(storage.get()).resolves.toBeNull();
  });

  it('clears and returns null for a corrupted stored session', async () => {
    const storage: SessionStorage = createMemorySessionStorage({
      token: 'token-1',
      expiresAt: 'not-a-date',
      userId: 'user-1',
    });
    const provider = createStoredAuthHeadersProvider(storage);

    await expect(provider.getAuthHeaders()).resolves.toBeNull();
    await expect(storage.get()).resolves.toBeNull();
  });

  it('returns null on a storage read failure (fail closed, no crash)', async () => {
    const storage: SessionStorage = {
      get: async () => {
        throw new Error('secure store unavailable');
      },
      save: async () => undefined,
      clear: async () => undefined,
    };
    const provider = createStoredAuthHeadersProvider(storage);

    await expect(provider.getAuthHeaders()).resolves.toBeNull();
  });

  it('clears the stored session on authentication failure (401 hook)', async () => {
    const storage: SessionStorage = createMemorySessionStorage({
      token: 'token-1',
      expiresAt: futureExpiry,
      userId: 'user-1',
    });
    const provider = createStoredAuthHeadersProvider(storage);

    provider.onAuthenticationFailure?.();

    await vi.waitFor(async () => {
      await expect(storage.get()).resolves.toBeNull();
    });
  });
});
