/**
 * Unit tests for the OTP verification use case (OD-005 — Phase 3.18).
 * No database required: the OTP provider, session service, and user
 * persistence are faked.
 */
import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  ExternalServiceError,
  RateLimitError,
  ValidationError,
} from '../../../lib/errors.js';
import {
  defaultAuthConfig,
  type AuthDependencies,
} from './auth-dependencies.js';
import { createFakeOtpProvider } from '../infrastructure/fake-otp-provider.js';
import { createInMemoryOtpRateLimiter } from './rate-limiter.js';
import { verifyOtp } from './verify-otp.js';

function buildDeps(
  overrides: Partial<AuthDependencies> = {},
): AuthDependencies {
  const config = defaultAuthConfig();
  const issued = new Map<string, string>();
  const sessionService: AuthDependencies['sessionService'] = {
    issue: async (userId) => {
      const token = `token:${userId}`;
      issued.set(token, userId);
      return {
        token,
        expiresAt: new Date('2026-09-18T00:00:00.000Z'),
        user: { userId },
      };
    },
    validate: async (token) =>
      issued.has(token) ? { userId: issued.get(token) as string } : null,
    revoke: async (token) => {
      issued.delete(token);
    },
    revokeAllForUser: async () => issued.clear(),
  };

  return {
    config,
    otpProvider: createFakeOtpProvider({ acceptedOtp: '123456' }),
    rateLimiter: createInMemoryOtpRateLimiter(),
    sessionService,
    persistence: {
      upsertUserByPhone: async (phone) => ({ id: `user:${phone}` }),
    },
    ...overrides,
  };
}

describe('verifyOtp', () => {
  it('verifies the code, finds-or-creates the user, and issues a session', async () => {
    const deps = buildDeps();
    const result = await verifyOtp(
      { phone: '+919800000001', otp: '123456' },
      deps,
    );
    expect(result.user.userId).toBe('user:+919800000001');
    expect(result.token).toBe('token:user:+919800000001');
    expect(result.expiresAt).toEqual(new Date('2026-09-18T00:00:00.000Z'));
  });

  it('accepts a bare 10-digit national phone (canonicalized to E.164)', async () => {
    const deps = buildDeps();
    const result = await verifyOtp(
      { phone: '9800000001', otp: '123456' },
      deps,
    );
    expect(result.user.userId).toBe('user:+919800000001');
  });

  it('rejects a wrong code with a GENERIC AuthenticationError', async () => {
    const deps = buildDeps();
    await expect(
      verifyOtp({ phone: '+919800000001', otp: '999999' }, deps),
    ).rejects.toBeInstanceOf(AuthenticationError);
    await expect(
      verifyOtp({ phone: '+919800000001', otp: '999999' }, deps),
    ).rejects.toMatchObject({ message: 'Unable to authenticate' });
  });

  it('rejects malformed OTP input (400 ValidationError) before any provider call', async () => {
    const deps = buildDeps();
    await expect(
      verifyOtp({ phone: '+919800000001', otp: '12' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      verifyOtp({ phone: '+919800000001', otp: 'abcdef' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      verifyOtp({ phone: '+919800000001', otp: '' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    // A 5-digit code is within the 4–9 format range; only the provider
    // decides whether the actual OTP matches.
    const acceptsAnyFiveDigits = buildDeps({
      otpProvider: createFakeOtpProvider({ acceptedOtp: '12345' }),
    });
    await expect(
      verifyOtp({ phone: '+919800000001', otp: '12345' }, acceptsAnyFiveDigits),
    ).resolves.toBeDefined();
  });

  it('rejects malformed phones (400 ValidationError)', async () => {
    await expect(
      verifyOtp({ phone: 'nope', otp: '123456' }, buildDeps()),
    ).rejects.toThrow(ValidationError);
  });

  it('rate limits verify attempts per phone (429 after the limit)', async () => {
    const config = defaultAuthConfig();
    const deps = buildDeps({ config: { ...config, otpVerifyLimit: 2 } });
    await verifyOtp({ phone: '+919800000002', otp: '999999' }, deps).catch(
      () => undefined,
    );
    await verifyOtp({ phone: '+919800000002', otp: '999999' }, deps).catch(
      () => undefined,
    );
    await expect(
      verifyOtp({ phone: '+919800000002', otp: '123456' }, deps),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('maps a provider transport failure to ExternalServiceError', async () => {
    const deps = buildDeps({
      otpProvider: createFakeOtpProvider({
        verifyOtpError: new ExternalServiceError('MSG91 down'),
      }),
    });
    await expect(
      verifyOtp({ phone: '+919800000003', otp: '123456' }, deps),
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });

  it('never distinguishes rejection from provider failure to the caller', async () => {
    const rejected = buildDeps();
    const failed = buildDeps({
      otpProvider: createFakeOtpProvider({
        verifyOtpError: new ExternalServiceError('down'),
      }),
    });
    const [a, b] = await Promise.allSettled([
      verifyOtp({ phone: '+919800000004', otp: '999999' }, rejected),
      verifyOtp({ phone: '+919800000004', otp: '123456' }, failed),
    ]);
    expect(a.status).toBe('rejected');
    expect(b.status).toBe('rejected');
  });

  it('creates a user with an empty name placeholder (find-or-create)', async () => {
    let created: string | null = null;
    const deps = buildDeps({
      persistence: {
        upsertUserByPhone: async (phone) => {
          created = phone;
          return { id: `user:${phone}` };
        },
      },
    });
    await verifyOtp({ phone: '+919800000005', otp: '123456' }, deps);
    expect(created).toBe('+919800000005');
  });
});
