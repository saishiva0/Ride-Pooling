/**
 * Shared application plumbing for authentication (OD-005 — Phase 3.18).
 *
 * All auth application services share: the OTP provider port, the rate
 * limiter, the session service, and the user persistence port. This follows
 * the notification pattern (`notification-dependencies.ts`): all Prisma
 * details stay in the infrastructure layer, the application layer depends
 * only on these shapes.
 */
import { prisma } from '../../../lib/prisma.js';
import type { AppConfig } from '../../../config/index.js';
import { upsertUserByPhone } from '../infrastructure/session.persistence.js';
import { createMsg91OtpProvider } from '../infrastructure/msg91-provider.js';
import { createPrismaSessionPersistence } from '../infrastructure/session.persistence.js';
import {
  createInMemoryOtpRateLimiter,
  type OtpRateLimiter,
} from './rate-limiter.js';
import {
  createSessionService,
  type SessionService,
} from './session-service.js';
import {
  OTP_REQUEST_LIMIT,
  OTP_REQUEST_WINDOW_MS,
  OTP_VERIFY_LIMIT,
  OTP_VERIFY_WINDOW_MS,
  type OtpProvider,
} from './otp-provider.js';
import type { E164Phone } from '../domain/phone.js';

/** OTP/session policy knobs (rate limits are the documented V1 values). */
export interface AuthConfig {
  otpRequestLimit: number;
  otpRequestWindowMs: number;
  otpVerifyLimit: number;
  otpVerifyWindowMs: number;
}

export function defaultAuthConfig(): AuthConfig {
  return {
    otpRequestLimit: OTP_REQUEST_LIMIT,
    otpRequestWindowMs: OTP_REQUEST_WINDOW_MS,
    otpVerifyLimit: OTP_VERIFY_LIMIT,
    otpVerifyWindowMs: OTP_VERIFY_WINDOW_MS,
  };
}

/** User persistence port: find-or-create by verified phone. */
export interface AuthUserPersistence {
  upsertUserByPhone(phone: E164Phone): Promise<{ id: string }>;
}

/** The complete set of auth application dependencies. */
export interface AuthDependencies {
  config: AuthConfig;
  otpProvider: OtpProvider;
  rateLimiter: OtpRateLimiter;
  sessionService: SessionService;
  persistence: AuthUserPersistence;
}

/** Default wiring for the running backend (real MSG91 + Prisma). */
export function createDefaultAuthDependencies(
  config: AppConfig,
): AuthDependencies {
  return {
    config: defaultAuthConfig(),
    otpProvider: createMsg91OtpProvider({
      authKey: config.MSG91_AUTH_KEY ?? null,
      senderId: config.MSG91_SENDER_ID ?? null,
      baseUrl: config.MSG91_BASE_URL ?? 'https://api.msg91.com',
      otpExpiryMinutes: config.MSG91_OTP_EXPIRY_MINUTES,
      otpLength: config.MSG91_OTP_LENGTH,
    }),
    rateLimiter: createInMemoryOtpRateLimiter(),
    sessionService: createSessionService({
      persistence: createPrismaSessionPersistence(),
      now: () => new Date(),
      ttlDays: config.SESSION_TTL_DAYS,
    }),
    persistence: {
      upsertUserByPhone: (phone) =>
        prisma.$transaction((tx) => upsertUserByPhone(tx, phone)),
    },
  };
}
