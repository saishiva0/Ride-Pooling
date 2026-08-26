/**
 * Fake OTP provider (test infrastructure).
 *
 * A deterministic `OtpProvider` for unit/integration tests — the real network
 * and MSG91 are never touched. Defaults to "everything succeeds"; each
 * operation can be forced to throw or to reject a specific code.
 */
import type { OtpProvider } from '../application/otp-provider.js';

export interface FakeOtpProviderOptions {
  /** Thrown by `requestOtp` when set (tests pass an `ExternalServiceError`). */
  requestOtpError?: unknown;
  /** Thrown by `verifyOtp` when set (transport/provider failure). */
  verifyOtpError?: unknown;
  /** Thrown by `retryOtp` when set. */
  retryOtpError?: unknown;
  /** When set, `verifyOtp` accepts only this exact code. */
  acceptedOtp?: string;
  /** When `acceptedOtp` is unset, the verify result (default true). */
  verifyResult?: boolean;
}

export function createFakeOtpProvider(
  options: FakeOtpProviderOptions = {},
): OtpProvider {
  return {
    async requestOtp(): Promise<void> {
      if (options.requestOtpError !== undefined) {
        throw options.requestOtpError;
      }
    },
    async verifyOtp(_phone: string, otp: string): Promise<boolean> {
      if (options.verifyOtpError !== undefined) {
        throw options.verifyOtpError;
      }
      if (options.acceptedOtp !== undefined) {
        return otp === options.acceptedOtp;
      }
      return options.verifyResult ?? true;
    },
    async retryOtp(): Promise<void> {
      if (options.retryOtpError !== undefined) {
        throw options.retryOtpError;
      }
    },
  };
}
