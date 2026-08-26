/**
 * Auth HTTP request schemas (OD-005 — Phase 3.18).
 *
 * Boundary-level Zod validation only. Detailed phone (E.164) and OTP format
 * validation lives in the application services so the SAME rules apply to
 * every caller.
 */
import { z } from 'zod';

/** POST /api/v1/auth/request-otp — request body. */
export const requestOtpSchema = z.object({
  phone: z.string().trim().min(1, 'phone is required'),
});

/** POST /api/v1/auth/verify-otp — request body. */
export const verifyOtpSchema = z.object({
  phone: z.string().trim().min(1, 'phone is required'),
  otp: z.string().trim().min(1, 'otp is required'),
});
