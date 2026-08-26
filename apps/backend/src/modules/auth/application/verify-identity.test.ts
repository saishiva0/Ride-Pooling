/**
 * Unit tests for the identity verification service (Phase 3.9) with injected
 * fake persistence — no database required.
 *
 * Security focus: valid identities resolve; invalid credentials (unknown
 * user) and malformed authentication data fail with a GENERIC
 * `AuthenticationError` (no account enumeration, no structure leakage); the
 * store can never substitute a different user; persistence failures are
 * wrapped and never exposed.
 */
import { describe, expect, it } from 'vitest';
import {
  AppError,
  AuthenticationError,
  InternalError,
} from '../../../lib/errors.js';
import { createAuthenticatedUser } from '../domain/identity.js';
import { verifyAuthenticatedIdentity } from './verify-identity.js';

const existingUser = (id: string) => async () => ({ id });

describe('verifyAuthenticatedIdentity', () => {
  it('resolves a valid identity for an existing user', async () => {
    const result = await verifyAuthenticatedIdentity(
      createAuthenticatedUser('user-1'),
      { findUserById: existingUser('user-1') },
    );

    expect(result).toEqual({ user: { userId: 'user-1' } });
    // Result carries only the identity — no credentials or user data.
    expect(Object.keys(result.user)).toEqual(['userId']);
  });

  it('fails with a generic error for an unknown user (no enumeration)', async () => {
    const unknownId = 'no-such-user-xyz';
    const error = await verifyAuthenticatedIdentity(
      createAuthenticatedUser(unknownId),
      { findUserById: async () => null },
    ).then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error).toMatchObject({
      statusCode: 401,
      message: 'Authentication failed',
    });
    // The message never reveals whether the account exists.
    expect((error as AppError).message).not.toContain(unknownId);
  });

  it('fails safely on malformed authentication data', async () => {
    const malformed = [
      null,
      undefined,
      {},
      { userId: '' },
      { userId: '  ' },
      42,
    ];

    for (const input of malformed) {
      const error = await verifyAuthenticatedIdentity(input as never).then(
        () => null,
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(AuthenticationError);
      expect((error as AppError).message).toBe('Authentication failed');
    }
  });

  it('does not call the persistence layer for malformed input', async () => {
    let calls = 0;
    await verifyAuthenticatedIdentity({} as never, {
      findUserById: async () => {
        calls += 1;
        return { id: 'x' };
      },
    }).catch(() => undefined);

    expect(calls).toBe(0);
  });

  it('never lets the persistence layer substitute a different user', async () => {
    // Corrupt store: returns a DIFFERENT user id than the one presented. The
    // boundary must still authenticate exactly the presented identity.
    const result = await verifyAuthenticatedIdentity(
      createAuthenticatedUser('alice'),
      { findUserById: async () => ({ id: 'bob' }) },
    );

    expect(result.user.userId).toBe('alice');
  });

  it('wraps unexpected persistence failures without leaking them', async () => {
    const error = await verifyAuthenticatedIdentity(
      createAuthenticatedUser('user-1'),
      {
        findUserById: async () => {
          throw new Error('raw db exploded');
        },
      },
    ).then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(InternalError);
    expect(error).toMatchObject({ expose: false });
    // The raw DB message never reaches the boundary surface.
    expect((error as AppError).message).not.toContain('raw db exploded');
  });
});
