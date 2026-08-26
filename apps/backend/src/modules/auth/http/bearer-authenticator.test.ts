/**
 * Unit tests for the bearer-token HTTP authenticator (OD-005 — Phase 3.18).
 */
import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { AuthenticationError } from '../../../lib/errors.js';
import type { SessionService } from '../application/session-service.js';
import {
  createBearerTokenAuthenticator,
  getBearerToken,
} from './bearer-authenticator.js';

function mockRequest(headers: Record<string, string | undefined>): Request {
  return { headers } as unknown as Request;
}

const sessionService: SessionService = {
  issue: async () => {
    throw new Error('unused');
  },
  validate: async (token) =>
    token === 'valid-token' ? { userId: 'user-1' } : null,
  revoke: async () => undefined,
  revokeAllForUser: async () => undefined,
};

describe('getBearerToken', () => {
  it('extracts the token from a Bearer header (case-insensitive)', () => {
    expect(
      getBearerToken(mockRequest({ authorization: 'Bearer abc.def' })),
    ).toBe('abc.def');
    expect(
      getBearerToken(mockRequest({ authorization: 'bearer abc.def' })),
    ).toBe('abc.def');
  });

  it('returns null for missing/malformed headers', () => {
    expect(getBearerToken(mockRequest({}))).toBeNull();
    expect(
      getBearerToken(mockRequest({ authorization: 'Basic abc' })),
    ).toBeNull();
    expect(getBearerToken(mockRequest({ authorization: 'Bearer' }))).toBeNull();
  });
});

describe('createBearerTokenAuthenticator', () => {
  const authenticator = createBearerTokenAuthenticator(sessionService);

  it('resolves a valid token to the AuthenticatedUser', async () => {
    await expect(
      authenticator.authenticate(
        mockRequest({ authorization: 'Bearer valid-token' }),
      ),
    ).resolves.toEqual({ userId: 'user-1' });
  });

  it('throws a GENERIC AuthenticationError for a missing token', async () => {
    await expect(
      authenticator.authenticate(mockRequest({})),
    ).rejects.toMatchObject({ message: 'Authentication failed' });
  });

  it('throws the SAME generic error for an unknown/expired/revoked token', async () => {
    await expect(
      authenticator.authenticate(
        mockRequest({ authorization: 'Bearer bad-token' }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
    await expect(
      authenticator.authenticate(
        mockRequest({ authorization: 'Bearer bad-token' }),
      ),
    ).rejects.toMatchObject({ message: 'Authentication failed' });
  });

  it('never reveals whether a token was malformed, expired, or revoked', async () => {
    const missing = authenticator
      .authenticate(mockRequest({}))
      .catch((e: unknown) => (e as Error).message);
    const invalid = authenticator
      .authenticate(mockRequest({ authorization: 'Bearer nope' }))
      .catch((e: unknown) => (e as Error).message);
    expect(await missing).toBe(await invalid);
  });
});
