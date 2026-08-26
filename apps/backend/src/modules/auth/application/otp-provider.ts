/**
 * OTP provider port (OD-005 — resolved Phase 3.18: phone + OTP via MSG91).
 *
 * The application layer depends only on this shape. The concrete MSG91
 * implementation lives in `infrastructure/msg91-provider.ts`; tests inject a
 * fake (`infrastructure/fake-otp-provider.ts`).
 *
 * Contract for implementations:
 *
 *   - `requestOtp(phone)` sends a fresh OTP. `phone` is canonical E.164
 *     (`+…`). Failures (provider error, unconfigured, network) throw
 *     `ExternalServiceError` (not exposed to clients).
 *   - `verifyOtp(phone, otp)` returns `true` when the OTP was accepted,
 *     `false` when the code is wrong/expired (the caller maps this to a
 *     generic 401). Only transport/provider failures throw — the boolean is
 *     reserved for "the presented code was rejected", so account existence is
 *     never revealed through the return channel.
 *   - `retryOtp(phone)` re-sends the current OTP; failures throw
 *     `ExternalServiceError`.
 */

/** MSG91 (SMS) OTP delivery/verification provider. */
export interface OtpProvider {
  /** Sends a fresh OTP to `phone`. */
  requestOtp(phone: string): Promise<void>;
  /** Verifies the OTP presented for `phone`. */
  verifyOtp(phone: string, otp: string): Promise<boolean>;
  /** Re-sends the current OTP to `phone` (text, never voice in V1). */
  retryOtp(phone: string): Promise<void>;
}

/** OTP request rate limit per phone. */
export const OTP_REQUEST_LIMIT = 3;
export const OTP_REQUEST_WINDOW_MS = 10 * 60 * 1000;

/** OTP verify-attempt rate limit per phone. */
export const OTP_VERIFY_LIMIT = 5;
export const OTP_VERIFY_WINDOW_MS = 10 * 60 * 1000;
