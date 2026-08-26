/**
 * Phase 3.9 real-database integration tests for the auth module.
 *
 * Exercises the identity verification service and repository against the real
 * PostgreSQL database, and verifies the EXISTING User model behaviors the
 * authentication boundary relies on (unique identifiers, nullable contact
 * fields, FK integrity). No credential columns were added (OD-005 resolved
 * to phone+OTP keying on the existing phone uniqueness) — these tests run
 * against the Phase 2 `User` model.
 *
 * Requires a reachable dev database with the Phase 2 migration applied.
 * Fixtures follow the established conventions: RUN_ID prefixes, cleanup in
 * `afterAll`.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { AppError, AuthenticationError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import {
  createAuthenticatedUser,
  isAuthenticatedUser,
} from '../domain/identity.js';
import { normalizeEmail, normalizePhone } from '../domain/identifiers.js';
import { verifyAuthenticatedIdentity } from '../application/verify-identity.js';

const RUN_ID = `authtest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let seq = 0;
function unique(label: string): string {
  seq += 1;
  return `${RUN_ID}_${label}_${seq}`;
}

const cleanup = {
  userIds: [] as string[],
};

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.$disconnect();
});

async function createUser(
  label: string,
  overrides: { phone?: string | null; email?: string | null } = {},
) {
  const user = await prisma.user.create({
    data: {
      name: `Test ${label}`,
      phone:
        overrides.phone === undefined ? `+91${unique(label)}` : overrides.phone,
      email: overrides.email,
    },
  });
  cleanup.userIds.push(user.id);
  return user;
}

describe('identity verification — real database', () => {
  it('resolves a real user id to an AuthenticationResult', async () => {
    const user = await createUser('verify-real');

    const result = await verifyAuthenticatedIdentity(
      createAuthenticatedUser(user.id),
    );

    expect(result.user.userId).toBe(user.id);
    expect(isAuthenticatedUser(result.user)).toBe(true);
    // No raw user data leaks into the result.
    expect(Object.keys(result.user)).toEqual(['userId']);
  });

  it('fails closed with a generic error for an unknown user', async () => {
    const unknownId = `unknown-${unique('user')}`;

    const error = await verifyAuthenticatedIdentity(
      createAuthenticatedUser(unknownId),
    ).then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error).toMatchObject({
      statusCode: 401,
      message: 'Authentication failed',
    });
    // No account enumeration: the message never contains the queried id.
    expect((error as AppError).message).not.toContain(unknownId);
  });

  it('fails closed for malformed identity input without touching the DB', async () => {
    await expect(
      verifyAuthenticatedIdentity({} as never),
    ).rejects.toBeInstanceOf(AuthenticationError);
    await expect(
      verifyAuthenticatedIdentity({ userId: '' }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe('User identifier uniqueness — auth boundary', () => {
  it('rejects a duplicate email (email is @unique)', async () => {
    const email = `person-${unique('email')}@example.dev`;
    await createUser('email-a', { email });

    await expect(createUser('email-b', { email })).rejects.toThrow();
  });

  it('requires at least one contact identifier (User_contact_required check)', async () => {
    await expect(
      createUser('no-contact', { phone: null, email: null }),
    ).rejects.toThrow();
  });

  it('allows multiple users who share only the required contact shape (phone-only vs email-only)', async () => {
    const a = await createUser('phone-only', {
      phone: `+91${unique('p')}`,
      email: null,
    });
    const b = await createUser('email-only', {
      phone: null,
      email: `only-${unique('e')}@example.dev`,
    });

    expect(a.id).not.toBe(b.id);
  });

  it('stores normalized identifiers so boundary comparison is consistent', async () => {
    // The auth boundary normalizes BEFORE persistence: the stored email is
    // lowercase/trimmed and the stored phone has separators stripped — the
    // same normalization a future login lookup would apply.
    const email = normalizeEmail(`  Person-${unique('norm')}@Example.DEV  `);
    const phone = normalizePhone(`+91 ${unique('norm-phone')}`);
    const user = await createUser('normalized', { email, phone });

    const persisted = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { email: true, phone: true },
    });
    expect(persisted.email).toBe(email.toLowerCase());
    expect(persisted.phone).toBe(phone);
    expect(persisted.phone).not.toMatch(/[\s\-().]/);
  });

  it('rejects a duplicate phone even when visually formatted differently', async () => {
    const base = unique('dup-phone');
    await createUser('dup-a', { phone: normalizePhone(`+91 ${base}`) });

    await expect(
      createUser('dup-b', { phone: normalizePhone(`+91-${base}`) }),
    ).rejects.toThrow();
  });
});
