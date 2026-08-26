/**
 * OTP verification use case (OD-005 — Phase 3.18).
 *
 * Verifies a phone + OTP through the provider, finds-or-creates the user, and
 * issues an application session. Security behavior:
 *
 *   - Input is validated (E.164 phone; OTP is 4–9 digits) BEFORE any provider
 *     call so junk input fails fast without touching MSG91.
 *   - Every "rejected code" case maps to the SAME generic 401
 *     (`Unable to authenticate`); the provider's boolean is never distinguished
 *     from a transport failure in a way a caller can exploit, and provider
 *     error messages never reach the client.
 *   - Verify attempts are rate limited per phone.
 *   - A verified phone gets a user record via find-or-create (a bare `name: ''`
 *     until profile editing exists) and a fresh session; the raw session token
 *     is returned exactly once and only its hash is persisted.
 */
import {
  AuthenticationError,
  ExternalServiceError,
  RateLimitError,
  ValidationError,
} from '../../../lib/errors.js';
import { parseE164Phone } from '../domain/phone.js';
import type { AuthenticatedUser } from '../domain/identity.js';
import type { AuthDependencies } from './auth-dependencies.js';

/** OTP digit-count bounds (aligned with the MSG91 4–9 range). */
export const OTP_DIGITS_MIN = 4;
export const OTP_DIGITS_MAX = 9;

export interface VerifyOtpInput {
  phone: string;
  otp: string;
}

export interface VerifyOtpResult {
  /** The raw session token — returned exactly once, never stored. */
  token: string;
  expiresAt: Date;
  user: AuthenticatedUser;
}

function assertOtpInput(otp: unknown): string {
  if (typeof otp !== 'string' || otp.trim() === '') {
    throw new ValidationError('otp is required', { field: 'otp' });
  }
  const trimmed = otp.trim();
  if (
    !/^\d+$/.test(trimmed) ||
    trimmed.length < OTP_DIGITS_MIN ||
    trimmed.length > OTP_DIGITS_MAX
  ) {
    throw new ValidationError(
      `otp must be a ${OTP_DIGITS_MIN}-${OTP_DIGITS_MAX} digit code`,
      { field: 'otp' },
    );
  }
  return trimmed;
}

export async function verifyOtp(
  input: VerifyOtpInput,
  deps: AuthDependencies,
): Promise<VerifyOtpResult> {
  const { config, otpProvider, rateLimiter, sessionService, persistence } =
    deps;

  const phone = parseE164Phone(input.phone);
  const otp = assertOtpInput(input.otp);

  if (
    !rateLimiter.allow(
      `otp:verify:${phone}`,
      config.otpVerifyLimit,
      config.otpVerifyWindowMs,
    )
  ) {
    throw new RateLimitError(
      'Too many verification attempts. Try again later.',
    );
  }

  let verified: boolean;
  try {
    verified = await otpProvider.verifyOtp(phone, otp);
  } catch (err) {
    if (err instanceof RateLimitError) {
      throw err;
    }
    throw new ExternalServiceError('Unable to verify the OTP', { cause: err });
  }

  if (!verified) {
    // Generic and identical for every rejection — never reveal whether the
    // phone is registered or whether the code merely expired.
    throw new AuthenticationError('Unable to authenticate');
  }

  const user = await persistence.upsertUserByPhone(phone);
  const session = await sessionService.issue(user.id);

  return {
    token: session.token,
    expiresAt: session.expiresAt,
    user: { userId: session.user.userId },
  };
}
