/**
 * Phase 3.18 HTTP integration tests for phone + OTP authentication.
 *
 * Runs against the REAL Express application (supertest) and the REAL
 * PostgreSQL database. The MSG91 provider is faked (never the real network);
 * the session store and user find-or-create use the real Prisma persistence.
 * The DEFAULT bearer-token authenticator is exercised end-to-end.
 *
 * Covers: request-otp (generic 200 / 400), verify-otp (200 + session issued,
 * find-or-create dedup, wrong-code 401, rate limited 429), me (200 / 401),
 * logout (revokes the session, 200 then 401), and a protected business
 * endpoint requiring a real bearer token (401).
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { loadConfig } from '../../../config/index.js';
import { createLogger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { createFakeOtpProvider } from '../infrastructure/fake-otp-provider.js';
import { defaultAuthConfig } from '../application/auth-dependencies.js';

const ACCEPTED_OTP = '123456';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
const authDepsConfig = defaultAuthConfig();
const app = createApp({
  config,
  logger: createLogger({ level: 'silent', pretty: false }),
  authDeps: {
    otpProvider: createFakeOtpProvider({ acceptedOtp: ACCEPTED_OTP }),
  },
});

let seq = 0;
function uniquePhone(): string {
  seq += 1;
  return `98000${String(10000 + seq)}`; // 10-digit national number
}
function e164(phone: string): string {
  return `+91${phone}`;
}

const cleanup = {
  sessionIds: [] as string[],
  userIds: [] as string[],
};

async function trackUserAndSessions(userId: string) {
  cleanup.userIds.push(userId);
  const sessions = await prisma.authSession.findMany({
    where: { userId },
    select: { id: true },
  });
  for (const session of sessions) {
    cleanup.sessionIds.push(session.id);
  }
}

afterAll(async () => {
  await prisma.authSession.deleteMany({
    where: { id: { in: cleanup.sessionIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.$disconnect();
});

describe('POST /api/v1/auth/request-otp', () => {
  it('returns a generic success with the canonical E.164 phone (200)', async () => {
    const phone = uniquePhone();
    const res = await request(app)
      .post('/api/v1/auth/request-otp')
      .send({ phone });
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe(e164(phone));
  });

  it('is generic: succeeds identically for an unregistered phone', async () => {
    const phone = uniquePhone();
    const res = await request(app)
      .post('/api/v1/auth/request-otp')
      .send({ phone });
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe(e164(phone));
  });

  it('rejects a malformed phone with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/v1/auth/request-otp')
      .send({ phone: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.field).toBe('phone');
  });

  it('rejects a missing body with 400', async () => {
    const res = await request(app).post('/api/v1/auth/request-otp').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/auth/verify-otp', () => {
  it('verifies the code and issues a session (200, { data })', async () => {
    const phone = uniquePhone();
    await request(app).post('/api/v1/auth/request-otp').send({ phone });

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: ACCEPTED_OTP });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.user.userId).toBeTruthy();
    expect(res.body.data.expiresAt).toBeTruthy();

    // The created user has the empty-name placeholder (find-or-create).
    const user = await prisma.user.findUnique({
      where: { phone: e164(phone) },
    });
    expect(user).not.toBeNull();
    expect(user?.name).toBe('');
    await trackUserAndSessions(user!.id);

    // Only the hash is stored — the raw token never appears in the DB.
    const session = await prisma.authSession.findFirst({
      where: { userId: user!.id },
    });
    expect(session).not.toBeNull();
    expect(session!.tokenHash).not.toBe(res.body.data.token);
    expect(session!.tokenHash).toHaveLength(64); // sha256 hex
    cleanup.sessionIds.push(session!.id);
  });

  it('reuses the SAME user for a repeated verification (find-or-create dedup)', async () => {
    const phone = uniquePhone();
    const first = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: ACCEPTED_OTP });
    const second = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: ACCEPTED_OTP });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.user.userId).toBe(second.body.data.user.userId);
    await trackUserAndSessions(first.body.data.user.userId as string);
  });

  it('rejects a wrong code with a GENERIC 401', async () => {
    const phone = uniquePhone();
    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: '999999' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
    expect(res.body.error.message).toBe('Unable to authenticate');
  });

  it('rate limits verify attempts per phone (429)', async () => {
    const phone = uniquePhone();
    for (let i = 0; i < authDepsConfig.otpVerifyLimit; i += 1) {
      await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ phone, otp: '999999' });
    }
    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: ACCEPTED_OTP });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('GET /api/v1/auth/me (bearer session)', () => {
  async function signIn() {
    const phone = uniquePhone();
    const verify = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: ACCEPTED_OTP });
    await trackUserAndSessions(verify.body.data.user.userId as string);
    return {
      token: verify.body.data.token as string,
      userId: verify.body.data.user.userId as string,
    };
  }

  it('resolves the authenticated user with a valid token (200)', async () => {
    const { token, userId } = await signIn();
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.userId).toBe(userId);
  });

  it('rejects a missing token with a generic 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('rejects an unknown token with the SAME generic 401', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Authentication failed');
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the presented session (200, then 401 on reuse)', async () => {
    const phone = uniquePhone();
    const verify = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: ACCEPTED_OTP });
    await trackUserAndSessions(verify.body.data.user.userId as string);
    const token = verify.body.data.token as string;

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logout.status).toBe(200);

    const reuse = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(reuse.status).toBe(401);
  });
});

describe('protected business endpoints (default bearer authenticator)', () => {
  it('rejects requests without a real session token (401)', async () => {
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });
});
