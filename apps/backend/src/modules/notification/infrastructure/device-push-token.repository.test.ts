/**
 * Integration tests for device push token persistence (Phase 3.23).
 *
 * Runs against the REAL PostgreSQL database (matches the convention used by
 * `notification.integration.test.ts`) since these functions are thin Prisma
 * wrappers with no business logic worth faking.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import {
  registerDeviceToken,
  findDeviceTokenByToken,
  findActiveDeviceTokensForUser,
  findDeviceTokensForUser,
  deactivateDeviceToken,
  deactivateAllDeviceTokensForUser,
  updateDeviceTokenLastSeen,
  isValidPlatform,
} from './device-push-token.repository.js';

const RUN_ID = `devtok_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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

describe('registerDeviceToken', () => {
  it('creates a new active token', async () => {
    const user = await createUser('create');
    const token = unique('token');

    const row = await registerDeviceToken(prisma, {
      userId: user.id,
      token,
      platform: 'android',
    });

    expect(row.userId).toBe(user.id);
    expect(row.token).toBe(token);
    expect(row.platform).toBe('android');
    expect(row.isActive).toBe(true);
  });

  it('is idempotent for the same user + token (upsert, not duplicate rows)', async () => {
    const user = await createUser('idempotent');
    const token = unique('token');

    await registerDeviceToken(prisma, {
      userId: user.id,
      token,
      platform: 'android',
    });
    await registerDeviceToken(prisma, {
      userId: user.id,
      token,
      platform: 'ios',
    });

    const rows = await findDeviceTokensForUser(prisma, user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe('ios');
  });

  it('reactivates a previously deactivated token on re-registration', async () => {
    const user = await createUser('reactivate');
    const token = unique('token');

    await registerDeviceToken(prisma, {
      userId: user.id,
      token,
      platform: 'android',
    });
    await deactivateDeviceToken(prisma, token);

    const reactivated = await registerDeviceToken(prisma, {
      userId: user.id,
      token,
      platform: 'android',
    });

    expect(reactivated.isActive).toBe(true);
  });

  it('supports multiple distinct devices per user', async () => {
    const user = await createUser('multi-device');

    await registerDeviceToken(prisma, {
      userId: user.id,
      token: unique('a'),
      platform: 'android',
    });
    await registerDeviceToken(prisma, {
      userId: user.id,
      token: unique('b'),
      platform: 'ios',
    });

    const active = await findActiveDeviceTokensForUser(prisma, user.id);
    expect(active).toHaveLength(2);
  });
});

describe('deactivateDeviceToken / deactivateAllDeviceTokensForUser', () => {
  it('deactivates a single token without affecting others', async () => {
    const user = await createUser('deactivate-one');
    const keep = unique('keep');
    const drop = unique('drop');
    await registerDeviceToken(prisma, {
      userId: user.id,
      token: keep,
      platform: 'android',
    });
    await registerDeviceToken(prisma, {
      userId: user.id,
      token: drop,
      platform: 'android',
    });

    await deactivateDeviceToken(prisma, drop);

    const active = await findActiveDeviceTokensForUser(prisma, user.id);
    expect(active.map((t) => t.token)).toEqual([keep]);
  });

  it('returns null when deactivating a token that does not exist', async () => {
    const result = await deactivateDeviceToken(prisma, unique('missing'));
    expect(result).toBeNull();
  });

  it('deactivates all tokens for a user and returns the count', async () => {
    const user = await createUser('deactivate-all');
    await registerDeviceToken(prisma, {
      userId: user.id,
      token: unique('a'),
      platform: 'android',
    });
    await registerDeviceToken(prisma, {
      userId: user.id,
      token: unique('b'),
      platform: 'ios',
    });

    const count = await deactivateAllDeviceTokensForUser(prisma, user.id);

    expect(count).toBe(2);
    expect(await findActiveDeviceTokensForUser(prisma, user.id)).toHaveLength(
      0,
    );
  });

  it('deactivating all for a user does not affect another user tokens', async () => {
    const userA = await createUser('deactivate-all-a');
    const userB = await createUser('deactivate-all-b');
    await registerDeviceToken(prisma, {
      userId: userA.id,
      token: unique('a'),
      platform: 'android',
    });
    await registerDeviceToken(prisma, {
      userId: userB.id,
      token: unique('b'),
      platform: 'android',
    });

    await deactivateAllDeviceTokensForUser(prisma, userA.id);

    expect(await findActiveDeviceTokensForUser(prisma, userB.id)).toHaveLength(
      1,
    );
  });
});

describe('findDeviceTokenByToken / updateDeviceTokenLastSeen', () => {
  it('finds a token by its raw value', async () => {
    const user = await createUser('find-by-token');
    const token = unique('token');
    await registerDeviceToken(prisma, {
      userId: user.id,
      token,
      platform: 'android',
    });

    const found = await findDeviceTokenByToken(prisma, token);
    expect(found?.userId).toBe(user.id);
  });

  it('updates lastSeenAt for an existing token', async () => {
    const user = await createUser('last-seen');
    const token = unique('token');
    const created = await registerDeviceToken(prisma, {
      userId: user.id,
      token,
      platform: 'android',
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await updateDeviceTokenLastSeen(prisma, token);

    expect(updated).not.toBeNull();
    expect(updated!.lastSeenAt.getTime()).toBeGreaterThan(
      created.lastSeenAt.getTime(),
    );
  });

  it('returns null updating lastSeenAt for a missing token', async () => {
    const result = await updateDeviceTokenLastSeen(prisma, unique('missing'));
    expect(result).toBeNull();
  });
});

describe('isValidPlatform', () => {
  it.each(['android', 'ios'])('accepts %s', (platform) => {
    expect(isValidPlatform(platform)).toBe(true);
  });

  it.each(['web', 'Android', '', 'windows'])('rejects %s', (platform) => {
    expect(isValidPlatform(platform)).toBe(false);
  });
});
