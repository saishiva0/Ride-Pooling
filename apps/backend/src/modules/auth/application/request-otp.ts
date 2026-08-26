/**
 * OTP request use case (OD-005 — Phase 3.18).
 *
 * Sends a fresh OTP to a phone via the provider. Security behavior:
 *
 *   - The phone is parsed to canonical E.164 (`+…`) before any provider call.
 *   - The response is deliberately GENERIC (just the normalized phone): the
 *     caller never learns whether the phone is already registered, so no
 *     account enumeration is possible.
 *   - Requests are rate limited per phone (in-memory, documented single-
 *     instance limitation).
 *   - Provider failures surface as `ExternalServiceError` (never exposed).
 */
import { ExternalServiceError, RateLimitError } from '../../../lib/errors.js';
import { parseE164Phone, type E164Phone } from '../domain/phone.js';
import type { AuthDependencies } from './auth-dependencies.js';

export interface RequestOtpInput {
  phone: string;
}

export interface RequestOtpResult {
  /** The canonical E.164 phone the OTP was sent to. */
  phone: E164Phone;
}

export async function requestOtp(
  input: RequestOtpInput,
  deps: AuthDependencies,
): Promise<RequestOtpResult> {
  const { config, otpProvider, rateLimiter } = deps;

  const phone = parseE164Phone(input.phone);

  if (
    !rateLimiter.allow(
      `otp:request:${phone}`,
      config.otpRequestLimit,
      config.otpRequestWindowMs,
    )
  ) {
    throw new RateLimitError('Too many OTP requests. Please try again later.');
  }

  try {
    await otpProvider.requestOtp(phone);
  } catch (err) {
    if (err instanceof RateLimitError) {
      throw err;
    }
    // Never surface provider internals or the configured OTP settings.
    throw new ExternalServiceError('Failed to send the OTP', { cause: err });
  }

  return { phone };
}
