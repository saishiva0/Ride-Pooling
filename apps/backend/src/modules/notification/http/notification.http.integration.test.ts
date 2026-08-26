/**
 * Phase 3.10 HTTP integration tests for the notification API.
 *
 * Runs against the REAL Express application (supertest) and the REAL
 * PostgreSQL database, with the explicit TEST/DEVELOPMENT authenticator
 * (`x-test-user-id` header; production uses the real bearer authenticator —
 * OD-005 resolved in Phase 3.18).
 *
 * Covers: list (200, limit/hasMore), mark-one read (200), ownership
 * enforcement (403), mark-all (200, scoped to the recipient), and
 * unauthenticated access (401).
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { NotificationType } from '@prisma/client';
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

const RUN_ID = `nothttp_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let seq = 0;
function unique(label: string): string {
  seq += 1;
  return `${RUN_ID}_${label}_${seq}`;
}

const cleanup = {
  notificationIds: [] as string[],
  userIds: [] as string[],
};

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { id: { in: cleanup.notificationIds } },
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

async function createNotification(userId: string, label: string) {
  const notification = await prisma.notification.create({
    data: {
      userId,
      type: NotificationType.RIDE_CONFIRMED,
      title: label,
      body: `${label} body`,
    },
  });
  cleanup.notificationIds.push(notification.id);
  return notification;
}

const authHeader = (userId: string) => ({ 'x-test-user-id': userId });

describe('GET /api/v1/notifications', () => {
  it('lists the authenticated user notifications newest first (200, { data })', async () => {
    const recipient = await createUser('list-http');
    const first = await createNotification(recipient.id, 'first');
    const second = await createNotification(recipient.id, 'second');

    const res = await request(app)
      .get('/api/v1/notifications')
      .set(authHeader(recipient.id));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data.unreadCount).toBe(2);
    expect(res.body.data.hasMore).toBe(false);
    const ids = res.body.data.notifications.map((n: { id: string }) => n.id);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
  });

  it('supports a limit query parameter with hasMore', async () => {
    const recipient = await createUser('list-limited-http');
    for (let i = 0; i < 3; i += 1) {
      await createNotification(recipient.id, `n${i}`);
    }

    const res = await request(app)
      .get('/api/v1/notifications')
      .set(authHeader(recipient.id))
      .query({ limit: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.notifications).toHaveLength(1);
    expect(res.body.data.hasMore).toBe(true);
  });

  it('rejects a malformed limit with 400', async () => {
    const recipient = await createUser('list-bad-limit');

    const res = await request(app)
      .get('/api/v1/notifications')
      .set(authHeader(recipient.id))
      .query({ limit: 'many' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication (401)', async () => {
    const res = await request(app).get('/api/v1/notifications');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });
});

describe('PATCH /api/v1/notifications/:notificationId/read', () => {
  it('marks an owned notification read (200)', async () => {
    const recipient = await createUser('mark-http');
    const notification = await createNotification(recipient.id, 'mark me');

    const res = await request(app)
      .patch(`/api/v1/notifications/${notification.id}/read`)
      .set(authHeader(recipient.id));

    expect(res.status).toBe(200);
    expect(res.body.data.read).toBe(true);
    expect(res.body.data.readAt).toBeTruthy();
  });

  it('rejects marking another user notification read with 403', async () => {
    const owner = await createUser('mark-owner-http');
    const stranger = await createUser('mark-stranger-http');
    const notification = await createNotification(owner.id, 'not yours');

    const res = await request(app)
      .patch(`/api/v1/notifications/${notification.id}/read`)
      .set(authHeader(stranger.id));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');

    // The notification remains unread.
    const persisted = await prisma.notification.findUniqueOrThrow({
      where: { id: notification.id },
    });
    expect(persisted.readAt).toBeNull();
  });

  it('returns 404 for an unknown notification', async () => {
    const recipient = await createUser('mark-missing-http');

    const res = await request(app)
      .patch(`/api/v1/notifications/${unique('notification')}/read`)
      .set(authHeader(recipient.id));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('PATCH /api/v1/notifications/read-all', () => {
  it('marks only the authenticated user unread notifications read (200)', async () => {
    const recipient = await createUser('markall-http');
    const other = await createUser('markall-other-http');
    await createNotification(recipient.id, 'a');
    await createNotification(recipient.id, 'b');
    await createNotification(other.id, 'c');

    const res = await request(app)
      .patch('/api/v1/notifications/read-all')
      .set(authHeader(recipient.id));

    expect(res.status).toBe(200);
    expect(res.body.data.updatedCount).toBe(2);

    const otherUnread = await prisma.notification.count({
      where: { userId: other.id, readAt: null },
    });
    expect(otherUnread).toBe(1);
  });

  it('is idempotent: a second call updates zero rows', async () => {
    const recipient = await createUser('markall-idem-http');
    await createNotification(recipient.id, 'only');

    await request(app)
      .patch('/api/v1/notifications/read-all')
      .set(authHeader(recipient.id));

    const second = await request(app)
      .patch('/api/v1/notifications/read-all')
      .set(authHeader(recipient.id));

    expect(second.status).toBe(200);
    expect(second.body.data.updatedCount).toBe(0);
  });
});
