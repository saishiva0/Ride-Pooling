/**
 * Session service (OD-005 — resolved Phase 3.18: opaque bearer sessions).
 *
 * Issues, validates, and revokes application sessions. Persistence is
 * dependency-injected (the Prisma implementation lives in
 * `infrastructure/session.persistence.ts`) so the service is unit-testable
 * without a database — same pattern as the notification/ride services.
 *
 * Security properties:
 *
 *   - Only the SHA-256 hash of a token is ever persisted or read; the raw
 *     token is never stored, logged, or returned again after issuance.
 *   - `validate` rejects expired, revoked, and unknown tokens with `null` so
 *     the caller maps every case to the SAME generic authentication failure.
 *   - Malformed token input fails closed (treated as unknown → `null`).
 *   - Persistence failures become `InternalError` (never exposed verbatim).
 */
import { InternalError } from '../../../lib/errors.js';
import {
  generateSessionToken,
  hashSessionToken,
  sessionExpiryFromNow,
} from '../domain/session-token.js';
import type { AuthenticatedUser } from '../domain/identity.js';

/** A persisted session row (shape used by `SessionPersistence`). */
export interface SessionRow {
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** Persistence port implemented by the infrastructure layer. */
export interface SessionPersistence {
  createSession(params: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
  }): Promise<{ id: string }>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null>;
  revokeSession(tokenHash: string, revokedAt: Date): Promise<void>;
  revokeUserSessions(userId: string, revokedAt: Date): Promise<void>;
}

export interface SessionServiceDependencies {
  persistence: SessionPersistence;
  /** Clock injection for deterministic tests. */
  now: () => Date;
  /** Session lifetime in days. */
  ttlDays: number;
}

/** A freshly issued session (the token is returned exactly once). */
export interface IssuedSession {
  token: string;
  expiresAt: Date;
  user: AuthenticatedUser;
}

/** The application-facing session operations. */
export interface SessionService {
  issue(userId: string): Promise<IssuedSession>;
  /** Resolves a token to its user, or `null` for unknown/expired/revoked. */
  validate(token: string): Promise<AuthenticatedUser | null>;
  revoke(token: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
}

/** Upper bound on accepted token input (base64url token is ~43 chars). */
const MAX_TOKEN_INPUT_LENGTH = 128;

export function createSessionService(
  deps: SessionServiceDependencies,
): SessionService {
  async function guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      throw new InternalError('Session store failure', { cause: err });
    }
  }

  return {
    async issue(userId) {
      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);
      const now = deps.now();
      const expiresAt = sessionExpiryFromNow(now, deps.ttlDays);
      await guard(() =>
        deps.persistence.createSession({
          userId,
          tokenHash,
          expiresAt,
          createdAt: now,
        }),
      );
      return { token, expiresAt, user: { userId } };
    },

    async validate(token) {
      if (
        typeof token !== 'string' ||
        token.trim() === '' ||
        token.length > MAX_TOKEN_INPUT_LENGTH
      ) {
        return null;
      }
      const tokenHash = hashSessionToken(token);
      const session = await guard(() =>
        deps.persistence.findSessionByTokenHash(tokenHash),
      );
      if (!session || session.revokedAt !== null) {
        return null;
      }
      if (session.expiresAt.getTime() <= deps.now().getTime()) {
        return null;
      }
      return { userId: session.userId };
    },

    async revoke(token) {
      if (typeof token !== 'string' || token.trim() === '') {
        return;
      }
      await guard(() =>
        deps.persistence.revokeSession(hashSessionToken(token), deps.now()),
      );
    },

    async revokeAllForUser(userId) {
      await guard(() =>
        deps.persistence.revokeUserSessions(userId, deps.now()),
      );
    },
  };
}
