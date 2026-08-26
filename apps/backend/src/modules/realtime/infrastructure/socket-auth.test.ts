/**
 * Unit tests for socket authentication (Phase 3.11).
 *
 * The socket identity comes from the SAME `HttpAuthenticator` abstraction as
 * the REST boundary — the handshake headers are the only input. Fail-closed
 * and test/development authenticators behave identically here and in REST.
 */
import { describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io';
import { AuthenticationError } from '../../../lib/errors.js';
import {
  createTestAuthenticator,
  failClosedAuthenticator,
} from '../../auth/http/auth.middleware.js';
import { authenticateSocket } from './socket-auth.js';

function fakeSocket(
  headers: Record<string, string | string[] | undefined>,
): Socket {
  return {
    handshake: { headers },
  } as unknown as Socket;
}

describe('authenticateSocket', () => {
  it('resolves the identity from handshake headers via the shared authenticator', async () => {
    const user = await authenticateSocket(
      createTestAuthenticator(),
      fakeSocket({ 'x-test-user-id': 'user-42' }),
    );

    expect(user).toEqual({ userId: 'user-42' });
  });

  it('rejects a missing identity (fail closed, generic error)', async () => {
    await expect(
      authenticateSocket(createTestAuthenticator(), fakeSocket({})),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects a blank identity', async () => {
    await expect(
      authenticateSocket(
        createTestAuthenticator(),
        fakeSocket({ 'x-test-user-id': '   ' }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('fails closed with the explicit fail-closed authenticator', async () => {
    await expect(
      authenticateSocket(
        failClosedAuthenticator,
        fakeSocket({ 'x-test-user-id': 'anyone' }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});
