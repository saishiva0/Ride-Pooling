import { describe, expect, it, vi } from 'vitest';
import { MobileError } from '../api/errors';
import type { AuthApi } from './auth-api';
import {
  AuthenticationUnavailableError,
  createAuthClient,
  unavailableAuthClient,
  type AuthClient,
} from './auth-client';
import { createMemorySessionStorage } from './storage/memory';
import type { SessionStorage } from './storage/types';
import { isAuthSession } from './types';

const user = { userId: 'user-1' };
const storedToken = 'session-token-abc';
const storedExpiry = new Date(
  Date.now() + 30 * 24 * 60 * 60 * 1000,
).toISOString();

function fakeAuthApi(
  overrides: Partial<AuthApi> = {},
): AuthApi & { requestOtp: ReturnType<typeof vi.fn> } {
  const api: AuthApi = {
    requestOtp: vi.fn(async () => ({ phone: '+919876543210' })),
    verifyOtp: vi.fn(async () => ({
      token: storedToken,
      expiresAt: storedExpiry,
      user,
    })),
    me: vi.fn(async () => ({ user })),
    logout: vi.fn(async () => undefined),
    ...overrides,
  };
  return api as AuthApi & { requestOtp: ReturnType<typeof vi.fn> };
}

describe('unavailableAuthClient (fail-closed default)', () => {
  it('resolves getSession() to null — no session exists without a real client', async () => {
    await expect(unavailableAuthClient.getSession()).resolves.toBeNull();
  });

  it('throws AuthenticationUnavailableError from requestOtp()', async () => {
    await expect(
      unavailableAuthClient.requestOtp('+91'),
    ).rejects.toBeInstanceOf(AuthenticationUnavailableError);
  });

  it('throws AuthenticationUnavailableError from signIn()', async () => {
    await expect(
      unavailableAuthClient.signIn('+919876543210', '123456'),
    ).rejects.toBeInstanceOf(AuthenticationUnavailableError);
  });

  it('resolves signOut() as a safe no-op', async () => {
    await expect(unavailableAuthClient.signOut()).resolves.toBeUndefined();
  });

  it('never fabricates credentials, tokens, or sessions', async () => {
    const session = await unavailableAuthClient.getSession();
    expect(session).toBeNull();
  });
});

describe('createAuthClient', () => {
  it('signIn verifies the OTP, persists the session, and returns it', async () => {
    const api = fakeAuthApi();
    const storage: SessionStorage = createMemorySessionStorage();
    const client = createAuthClient({ api, storage });

    const session = await client.signIn('+919876543210', '123456');

    expect(api.verifyOtp).toHaveBeenCalledWith('+919876543210', '123456');
    expect(session).toEqual({ user: { userId: 'user-1' } });
    const stored = await storage.get();
    expect(stored).toEqual({
      token: storedToken,
      expiresAt: storedExpiry,
      userId: 'user-1',
    });
  });

  it('requestOtp forwards the phone and resolves generically', async () => {
    const api = fakeAuthApi();
    const client = createAuthClient({
      api,
      storage: createMemorySessionStorage(),
    });

    await client.requestOtp('+919876543210');

    expect(api.requestOtp).toHaveBeenCalledWith('+919876543210');
  });

  it('getSession returns null when nothing is stored (unauthenticated)', async () => {
    const api = fakeAuthApi();
    const client = createAuthClient({
      api,
      storage: createMemorySessionStorage(),
    });

    await expect(client.getSession()).resolves.toBeNull();
    expect(api.me).not.toHaveBeenCalled();
  });

  it('getSession re-validates a stored session with the backend (GET /auth/me)', async () => {
    const api = fakeAuthApi();
    const storage: SessionStorage = createMemorySessionStorage();
    await storage.save({
      token: storedToken,
      expiresAt: storedExpiry,
      userId: 'user-1',
    });
    const client = createAuthClient({ api, storage });

    const session = await client.getSession();

    expect(api.me).toHaveBeenCalledOnce();
    expect(session).toEqual({ user: { userId: 'user-1' } });
  });

  it('getSession clears + returns null when the backend rejects the stored session', async () => {
    const api = fakeAuthApi({
      me: async () => {
        throw new MobileError('authentication', 'Unable to authenticate');
      },
    });
    const storage: SessionStorage = createMemorySessionStorage();
    await storage.save({
      token: storedToken,
      expiresAt: storedExpiry,
      userId: 'user-1',
    });
    const client = createAuthClient({ api, storage });

    await expect(client.getSession()).resolves.toBeNull();
    await expect(storage.get()).resolves.toBeNull();
  });

  it('getSession returns null on a storage read failure (fail closed, no crash)', async () => {
    const api = fakeAuthApi();
    const storage: SessionStorage = {
      get: async () => {
        throw new Error('secure store unavailable');
      },
      save: async () => undefined,
      clear: async () => undefined,
    };
    const client = createAuthClient({ api, storage });

    await expect(client.getSession()).resolves.toBeNull();
  });

  it('getSession clears + returns null for an already-expired stored session', async () => {
    const api = fakeAuthApi();
    const storage: SessionStorage = createMemorySessionStorage();
    await storage.save({
      token: storedToken,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      userId: 'user-1',
    });
    const client = createAuthClient({ api, storage });

    await expect(client.getSession()).resolves.toBeNull();
    await expect(storage.get()).resolves.toBeNull();
    expect(api.me).not.toHaveBeenCalled();
  });

  it('getSession clears + returns null when the stored user does not match the backend', async () => {
    const api = fakeAuthApi({
      me: async () => ({ user: { userId: 'user-2' } }),
    });
    const storage: SessionStorage = createMemorySessionStorage();
    await storage.save({
      token: storedToken,
      expiresAt: storedExpiry,
      userId: 'user-1',
    });
    const client = createAuthClient({ api, storage });

    await expect(client.getSession()).resolves.toBeNull();
    await expect(storage.get()).resolves.toBeNull();
  });

  it('getSession propagates network/server failures (provider settles to authentication-error)', async () => {
    const api = fakeAuthApi({
      me: async () => {
        throw new MobileError('network', 'offline');
      },
    });
    const storage: SessionStorage = createMemorySessionStorage();
    await storage.save({
      token: storedToken,
      expiresAt: storedExpiry,
      userId: 'user-1',
    });
    const client = createAuthClient({ api, storage });

    await expect(client.getSession()).rejects.toBeInstanceOf(MobileError);
  });

  it('signOut revokes server-side and clears local storage (best-effort)', async () => {
    const api = fakeAuthApi();
    const storage: SessionStorage = createMemorySessionStorage();
    await storage.save({
      token: storedToken,
      expiresAt: storedExpiry,
      userId: 'user-1',
    });
    const client = createAuthClient({ api, storage });

    await client.signOut();

    expect(api.logout).toHaveBeenCalledOnce();
    await expect(storage.get()).resolves.toBeNull();
  });

  it('signOut clears local storage even when the server revoke fails', async () => {
    const api = fakeAuthApi({
      logout: async () => {
        throw new MobileError('network', 'offline');
      },
    });
    const storage: SessionStorage = createMemorySessionStorage();
    await storage.save({
      token: storedToken,
      expiresAt: storedExpiry,
      userId: 'user-1',
    });
    const client = createAuthClient({ api, storage });

    await expect(client.signOut()).resolves.toBeUndefined();
    await expect(storage.get()).resolves.toBeNull();
  });

  it('satisfies the AuthClient port contract', () => {
    const client: AuthClient = createAuthClient({
      api: fakeAuthApi(),
      storage: createMemorySessionStorage(),
    });
    expect(typeof client.getSession).toBe('function');
    expect(typeof client.requestOtp).toBe('function');
    expect(typeof client.signIn).toBe('function');
    expect(typeof client.signOut).toBe('function');
  });
});

describe('isAuthSession (structural guard)', () => {
  it('accepts a session with a non-blank userId', () => {
    expect(isAuthSession({ user: { userId: 'user-1' } })).toBe(true);
  });

  it('rejects malformed shapes (fail closed)', () => {
    expect(isAuthSession(null)).toBe(false);
    expect(isAuthSession(undefined)).toBe(false);
    expect(isAuthSession('nope')).toBe(false);
    expect(isAuthSession({})).toBe(false);
    expect(isAuthSession({ user: {} })).toBe(false);
    expect(isAuthSession({ user: { userId: '' } })).toBe(false);
    expect(isAuthSession({ user: { userId: '  ' } })).toBe(false);
    expect(isAuthSession({ user: { userId: 42 } })).toBe(false);
  });
});
