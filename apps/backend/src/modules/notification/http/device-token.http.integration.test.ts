/**
 * Phase 3.23 HTTP integration tests for the device push token API.
 *
 * Runs against the REAL Express application (supertest) and the REAL
 * PostgreSQL database, using the TEST authenticator (`x-test-user-id`
 * header). Covers: registration (201, { data }), idempotent duplicate
 * registration, listing, ownership-scoped deactivation (204/403/404),
 * deactivate-all, validation (400), unauthenticated access (401), and that
 * the recipient always comes from the authenticated identity — never a
 * client-supplied field.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { loadConfig } from '../../../config/index.js';
import { createLogger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { createTestAuthenticator } from '../../auth/http/auth.middleware.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
const app = createApp({
  config,
  logger: createLogger({ level: 'silent', pretty: false }),
  authenticator: createTestAuthenticator(),
});

const RUN_ID = `devtokhttp_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let seq = 0;
function unique(label: string): string {
  seq += 1;
  return `${RUN_ID}_${label}_${seq}`;
}

const cleanup = { userIds: [] as string[] };

afterAll(async () => {
  await prisma.devicePushToken.deleteMany({
    where: { userId: { in: cleanup.userIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.$disconnect();
});

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: { name: `Test ${label}`, phone: `+91${unique(label)}` },
  });
  cleanup.userIds.push(user.id);
  return user;
}

const authHeader = (userId: string) => ({ 'x-test-user-id': userId });

describe('POST /api/v1/notifications/device-tokens', () => {
  it('registers a device token for the authenticated user (201, { data })', async () => {
    const user = await createUser('register');
    const token = unique('token');

    const res = await request(app)
      .post('/api/v1/notifications/device-tokens')
      .set(authHeader(user.id))
      .send({ token, platform: 'android' });

    expect(res.status).toBe(201);
    expect(res.body.data.token).toBe(token);
    expect(res.body.data.isActive).toBe(true);
  });

  it('is idempotent: registering the same token twice updates rather than duplicates', async () => {
    const user = await createUser('register-dup');
    const token = unique('token');

    await request(app)
      .post('/api/v1/notifications/device-tokens')
      .set(authHeader(user.id))
      .send({ token, platform: 'android' });

    const second = await request(app)
      .post('/api/v1/notifications/device-tokens')
      .set(authHeader(user.id))
      .send({ token, platform: 'ios' });

    expect(second.status).toBe(201);
    expect(second.body.data.platform).toBe('ios');

    const list = await request(app)
      .get('/api/v1/notifications/device-tokens')
      .set(authHeader(user.id));
    expect(list.body.data).toHaveLength(1);
  });

  it('ignores a client-supplied recipient field — identity comes from auth only', async () => {
    const user = await createUser('register-no-spoof');
    const other = await createUser('register-no-spoof-other');
    const token = unique('token');

    const res = await request(app)
      .post('/api/v1/notifications/device-tokens')
      .set(authHeader(user.id))
      .send({
        token,
        platform: 'android',
        userId: other.id,
        recipientId: other.id,
      });

    expect(res.status).toBe(201);

    const stored = await prisma.devicePushToken.findUnique({
      where: { token },
    });
    expect(stored?.userId).toBe(user.id);
  });

  it('rejects an invalid platform with 400', async () => {
    const user = await createUser('register-bad-platform');

    const res = await request(app)
      .post('/api/v1/notifications/device-tokens')
      .set(authHeader(user.id))
      .send({ token: unique('token'), platform: 'web' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an empty token with 400', async () => {
    const user = await createUser('register-empty-token');

    const res = await request(app)
      .post('/api/v1/notifications/device-tokens')
      .set(authHeader(user.id))
      .send({ token: '', platform: 'android' });

    expect(res.status).toBe(400);
  });

  it('requires authentication (401)', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/device-tokens')
      .send({ token: unique('token'), platform: 'android' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });
});

describe('GET /api/v1/notifications/device-tokens', () => {
  it('lists only the authenticated user tokens', async () => {
    const user = await createUser('list');
    const other = await createUser('list-other');
    await request(app)
      .post('/api/v1/notifications/device-tokens')
      .set(authHeader(user.id))
      .send({ token: unique('mine'), platform: 'android' });
    await request(app)
      .post('/api/v1/notifications/device-tokens')
      .set(authHeader(other.id))
      .send({ token: unique('theirs'), platform: 'android' });

    const res = await request(app)
      .get('/api/v1/notifications/device-tokens')
      .set(authHeader(user.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('DELETE /api/v1/notifications/device-tokens/:token', () => {
  it('deactivates the caller own token (204)', async () => {
    const user = await createUser('deactivate-own');
    const token = unique('token');
    await request(app)
      .post('/api/v1/notifications/device-tokens')
      .set(authHeader(user.id))
      .send({ token, platform: 'android' });

    const res = await request(app)
      .delete(`/api/v1/notifications/device-tokens/${token}`)
      .set(authHeader(user.id));

    expect(res.status).toBe(204);
    const stored = await prisma.devicePushToken.findUnique({
      where: { token },
    });
    expect(stored?.isActive).toBe(false);
  });

  it('rejects deactivating another user token with 403', async () => {
    const owner = await createUser('deactivate-owner');
    const stranger = await createUser('deactivate-stranger');
    const token = unique('token');
    await request(app)
      .post('/api/v1/notifications/device-tokens')
      .set(authHeader(owner.id))
      .send({ token, platform: 'android' });

    const res = await request(app)
      .delete(`/api/v1/notifications/device-tokens/${token}`)
      .set(authHeader(stranger.id));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');

    const stored = await prisma.devicePushToken.findUnique({
      where: { token },
    });
    expect(stored?.isActive).toBe(true);
  });

  it('returns 404 for an unknown token', async () => {
    const user = await createUser('deactivate-missing');

    const res = await request(app)
      .delete(`/api/v1/notifications/device-tokens/${unique('missing')}`)
      .set(authHeader(user.id));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('DELETE /api/v1/notifications/device-tokens', () => {
  it('deactivates all of the caller tokens and returns the count', async () => {
    const user = await createUser('deactivate-all-http');
    await request(app)
      .post('/api/v1/notifications/device-tokens')
      .set(authHeader(user.id))
      .send({ token: unique('a'), platform: 'android' });
    await request(app)
      .post('/api/v1/notifications/device-tokens')
      .set(authHeader(user.id))
      .send({ token: unique('b'), platform: 'ios' });

    const res = await request(app)
      .delete('/api/v1/notifications/device-tokens')
      .set(authHeader(user.id));

    expect(res.status).toBe(200);
    expect(res.body.data.deactivatedCount).toBe(2);
  });

  it('requires authentication (401)', async () => {
    const res = await request(app).delete(
      '/api/v1/notifications/device-tokens',
    );
    expect(res.status).toBe(401);
  });
});
