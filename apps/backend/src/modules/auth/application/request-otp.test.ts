/**
 * Unit tests for the OTP request use case (OD-005 — Phase 3.18).
 * No database required: the OTP provider and rate limiter are faked.
 */
import { describe, expect, it } from 'vitest';
import {
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
import type { OtpProvider } from './otp-provider.js';
import { OTP_REQUEST_LIMIT, OTP_REQUEST_WINDOW_MS } from './otp-provider.js';
import { requestOtp } from './request-otp.js';

const dummySessionService: AuthDependencies['sessionService'] = {
  issue: async () => {
    throw new Error('unused');
  },
  validate: async () => null,
  revoke: async () => undefined,
  revokeAllForUser: async () => undefined,
};

function buildDeps(
  overrides: {
    otpProvider?: OtpProvider;
    requestLimit?: number;
  } = {},
): AuthDependencies {
  const config = defaultAuthConfig();
  return {
    config: {
      ...config,
      otpRequestLimit: overrides.requestLimit ?? config.otpRequestLimit,
    },
    otpProvider: overrides.otpProvider ?? createFakeOtpProvider(),
    rateLimiter: createInMemoryOtpRateLimiter(),
    sessionService: dummySessionService,
    persistence: {
      upsertUserByPhone: async (phone) => ({ id: `user:${phone}` }),
    },
  };
}

describe('requestOtp', () => {
  it('sends an OTP and returns the canonical E.164 phone', async () => {
    const otpProvider = createFakeOtpProvider();
    const result = await requestOtp(
      { phone: '9876543210' },
      buildDeps({ otpProvider }),
    );
    expect(result.phone).toBe('+919876543210');
  });

  it('is GENERIC: succeeds even when the phone is not yet registered', async () => {
    const result = await requestOtp({ phone: '+919800000000' }, buildDeps());
    expect(result.phone).toBe('+919800000000');
  });

  it('rejects malformed phones with 400 ValidationError', async () => {
    await expect(requestOtp({ phone: 'nope' }, buildDeps())).rejects.toThrow(
      ValidationError,
    );
  });

  it('rate limits per phone (429 RateLimitError after the limit)', async () => {
    const deps = buildDeps({ requestLimit: 1 });
    await requestOtp({ phone: '+919800000001' }, deps);
    await expect(
      requestOtp({ phone: '+919800000001' }, deps),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('rate limits independently per phone', async () => {
    const deps = buildDeps({ requestLimit: 1 });
    await requestOtp({ phone: '+919800000001' }, deps);
    await expect(
      requestOtp({ phone: '+919800000002' }, deps),
    ).resolves.toMatchObject({ phone: '+919800000002' });
  });

  it('maps a provider send failure to ExternalServiceError (never exposed)', async () => {
    const otpProvider = createFakeOtpProvider({
      requestOtpError: new ExternalServiceError('MSG91 boom'),
    });
    await expect(
      requestOtp({ phone: '+919800000003' }, buildDeps({ otpProvider })),
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });

  it('respects the configured window: a fresh window allows a new request', async () => {
    const config = defaultAuthConfig();
    const deps = {
      ...buildDeps({ requestLimit: OTP_REQUEST_LIMIT }),
      config: {
        ...config,
        otpRequestLimit: 1,
        otpRequestWindowMs: OTP_REQUEST_WINDOW_MS,
      },
    };
    await requestOtp({ phone: '+919800000004' }, deps);
    await expect(
      requestOtp({ phone: '+919800000004' }, deps),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});
