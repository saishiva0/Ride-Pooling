/**
 * Unit tests for the session service (OD-005 — Phase 3.18).
 * No database required: an in-memory `SessionPersistence` is injected and the
 * clock is deterministic.
 */
import { describe, expect, it } from 'vitest';
import { InternalError } from '../../../lib/errors.js';
import {
  createSessionService,
  type SessionPersistence,
  type SessionRow,
  type SessionService,
} from './session-service.js';
import { hashSessionToken } from '../domain/session-token.js';

function inMemoryPersistence(): SessionPersistence & {
  rows: Map<string, SessionRow>;
} {
  const rows = new Map<string, SessionRow>();
  return {
    rows,
    async createSession(params) {
      rows.set(params.tokenHash, {
        userId: params.userId,
        expiresAt: params.expiresAt,
        revokedAt: null,
      });
      return { id: `sess:${params.tokenHash}` };
    },
    async findSessionByTokenHash(tokenHash) {
      return rows.get(tokenHash) ?? null;
    },
    async revokeSession(tokenHash, revokedAt) {
      const row = rows.get(tokenHash);
      if (row) row.revokedAt = revokedAt;
    },
    async revokeUserSessions(userId, revokedAt) {
      for (const row of rows.values()) {
        if (row.userId === userId && row.revokedAt === null) {
          row.revokedAt = revokedAt;
        }
      }
    },
  };
}

function buildService(
  now: Date,
  persistence: SessionPersistence = inMemoryPersistence(),
): SessionService {
  return createSessionService({ persistence, now: () => now, ttlDays: 30 });
}

describe('session service', () => {
  it('issues a token, persists only its hash, and validates it back', async () => {
    const persistence = inMemoryPersistence();
    const service = buildService(
      new Date('2026-08-19T00:00:00.000Z'),
      persistence,
    );
    const issued = await service.issue('user-1');

    expect(issued.user).toEqual({ userId: 'user-1' });
    expect(issued.token.length).toBeGreaterThan(0);
    expect(issued.expiresAt.toISOString()).toBe('2026-09-18T00:00:00.000Z');
    // Only the hash is persisted — the raw token never reaches the store.
    expect(persistence.rows.has(hashSessionToken(issued.token))).toBe(true);
    expect([...persistence.rows.values()].every((r) => r !== null)).toBe(true);

    await expect(service.validate(issued.token)).resolves.toEqual({
      userId: 'user-1',
    });
  });

  it('rejects unknown tokens with null (same as any failure)', async () => {
    const service = buildService(new Date('2026-08-19T00:00:00.000Z'));
    await expect(service.validate('does-not-exist')).resolves.toBeNull();
  });

  it('rejects malformed token input fail-closed', async () => {
    const service = buildService(new Date('2026-08-19T00:00:00.000Z'));
    await expect(service.validate('')).resolves.toBeNull();
    await expect(service.validate('   ')).resolves.toBeNull();
    await expect(service.validate('x'.repeat(200))).resolves.toBeNull();
  });

  it('rejects expired sessions', async () => {
    const persistence = inMemoryPersistence();
    const issued = await buildService(
      new Date('2026-08-19T00:00:00.000Z'),
      persistence,
    ).issue('user-1');
    const later = buildService(
      new Date('2027-01-01T00:00:00.000Z'),
      persistence,
    );
    await expect(later.validate(issued.token)).resolves.toBeNull();
  });

  it('rejects revoked sessions', async () => {
    const persistence = inMemoryPersistence();
    const service = buildService(
      new Date('2026-08-19T00:00:00.000Z'),
      persistence,
    );
    const issued = await service.issue('user-1');
    await service.revoke(issued.token);
    await expect(service.validate(issued.token)).resolves.toBeNull();
  });

  it('revoke is idempotent (unknown tokens no-op)', async () => {
    const service = buildService(new Date('2026-08-19T00:00:00.000Z'));
    await expect(service.revoke('nope')).resolves.toBeUndefined();
    await expect(service.revoke('')).resolves.toBeUndefined();
  });

  it('revokes all sessions for a user only', async () => {
    const persistence = inMemoryPersistence();
    const service = buildService(
      new Date('2026-08-19T00:00:00.000Z'),
      persistence,
    );
    const a = await service.issue('user-a');
    const b1 = await service.issue('user-b');
    const b2 = await service.issue('user-b');

    await service.revokeAllForUser('user-b');
    await expect(service.validate(a.token)).resolves.toEqual({
      userId: 'user-a',
    });
    await expect(service.validate(b1.token)).resolves.toBeNull();
    await expect(service.validate(b2.token)).resolves.toBeNull();
  });

  it('wraps persistence failures as InternalError (never raw)', async () => {
    const failing: SessionPersistence = {
      createSession: async () => {
        throw new Error('db down');
      },
      findSessionByTokenHash: async () => {
        throw new Error('db down');
      },
      revokeSession: async () => {
        throw new Error('db down');
      },
      revokeUserSessions: async () => {
        throw new Error('db down');
      },
    };
    const service = buildService(new Date('2026-08-19T00:00:00.000Z'), failing);
    await expect(service.issue('user-1')).rejects.toBeInstanceOf(InternalError);
    await expect(service.validate('token')).rejects.toBeInstanceOf(
      InternalError,
    );
    await expect(service.revoke('token')).rejects.toBeInstanceOf(InternalError);
  });
});
