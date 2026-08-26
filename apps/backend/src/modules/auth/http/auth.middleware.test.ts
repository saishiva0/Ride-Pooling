/**
 * Unit tests for the HTTP authentication seam (Phase 3.10) — no database.
 *
 * Covers: identity resolution and storage, fail-closed default, the
 * test/development authenticator contract, generic failures (no account
 * enumeration), and wrapping of unexpected errors.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { AppError, AuthenticationError } from '../../../lib/errors.js';
import {
  createAuthenticatedUser,
  type AuthenticatedUser,
  type AuthenticationResult,
} from '../domain/identity.js';
import {
  createAuthMiddleware,
  createTestAuthenticator,
  failClosedAuthenticator,
  getAuthenticatedUser,
} from './auth.middleware.js';

function makeContext() {
  const res = {
    locals: {},
  } as unknown as Response;
  const req = { headers: {} } as unknown as Request;
  const next = vi.fn();
  return { req, res, next };
}

const okVerify = async (
  identity: AuthenticatedUser,
): Promise<AuthenticationResult> => ({
  user: identity,
});

describe('failClosedAuthenticator', () => {
  it('rejects every request with a generic AuthenticationError', async () => {
    await expect(
      failClosedAuthenticator.authenticate({} as Request),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe('createAuthMiddleware', () => {
  it('stores the verified identity and continues on success', async () => {
    const { req, res, next } = makeContext();
    const middleware = createAuthMiddleware(
      { authenticate: async () => createAuthenticatedUser('user-1') },
      okVerify,
    );

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
    expect(res.locals.authenticatedUser).toEqual({ userId: 'user-1' });
  });

  it('forwards a generic 401 when the authenticator rejects', async () => {
    const { req, res, next } = makeContext();
    const middleware = createAuthMiddleware(failClosedAuthenticator, okVerify);

    await middleware(req, res, next);

    const err = next.mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Authentication failed');
    expect(res.locals.authenticatedUser).toBeUndefined();
  });

  it('forwards the failure when the user does not exist (verify rejects)', async () => {
    const { req, res, next } = makeContext();
    const middleware = createAuthMiddleware(
      { authenticate: async () => createAuthenticatedUser('ghost') },
      async () => {
        throw new AuthenticationError('Authentication failed');
      },
    );

    await middleware(req, res, next);

    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(AuthenticationError);
    expect(res.locals.authenticatedUser).toBeUndefined();
  });

  it('wraps unexpected errors so raw failures never reach the client', async () => {
    const { req, res, next } = makeContext();
    const middleware = createAuthMiddleware(
      {
        async authenticate() {
          throw new Error('raw provider exploded');
        },
      },
      okVerify,
    );

    await middleware(req, res, next);

    const err = next.mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(500);
    expect(err.message).not.toContain('raw provider exploded');
  });
});

describe('createTestAuthenticator (test/development only)', () => {
  it('builds an identity from the x-test-user-id header', async () => {
    const authenticator = createTestAuthenticator();
    const identity = await authenticator.authenticate({
      headers: { 'x-test-user-id': 'user-42' },
    } as unknown as Request);

    expect(identity).toEqual({ userId: 'user-42' });
  });

  it('rejects when the header is missing or blank', async () => {
    const authenticator = createTestAuthenticator();
    await expect(
      authenticator.authenticate({ headers: {} } as unknown as Request),
    ).rejects.toBeInstanceOf(AuthenticationError);
    await expect(
      authenticator.authenticate({
        headers: { 'x-test-user-id': '   ' },
      } as unknown as Request),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe('getAuthenticatedUser', () => {
  it('returns the identity stored by the middleware', () => {
    const res = {
      locals: { authenticatedUser: { userId: 'user-1' } },
    } as unknown as Response;

    expect(getAuthenticatedUser(res)).toEqual({ userId: 'user-1' });
  });

  it('fails closed with a generic 401 when absent', () => {
    const res = { locals: {} } as unknown as Response;

    expect(() => getAuthenticatedUser(res)).toThrow(AuthenticationError);
  });
});
