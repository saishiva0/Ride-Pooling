/**
 * Auth API surface (Phase 3.18 — OD-005 resolved).
 *
 * The ONLY mobile code that talks to the backend auth endpoints. Thin typed
 * wrappers over the generic `ApiClient` (public endpoints need no session;
 * `me`/`logout` ride the configured auth headers). No business logic lives
 * here — the `AuthClient` in `auth-client.ts` owns session semantics.
 */
import type { ApiClient } from '../api/client';

export interface RequestOtpResult {
  phone: string;
}

export interface VerifyOtpResult {
  token: string;
  expiresAt: string;
  user: { userId: string };
}

export interface MeResult {
  user: { userId: string };
}

export interface AuthApi {
  requestOtp(phone: string): Promise<RequestOtpResult>;
  verifyOtp(phone: string, otp: string): Promise<VerifyOtpResult>;
  me(): Promise<MeResult>;
  logout(): Promise<void>;
}

export function createAuthApi(client: ApiClient): AuthApi {
  return {
    requestOtp: (phone) =>
      client.request<RequestOtpResult>('/auth/request-otp', {
        method: 'POST',
        body: { phone },
      }),
    verifyOtp: (phone, otp) =>
      client.request<VerifyOtpResult>('/auth/verify-otp', {
        method: 'POST',
        body: { phone, otp },
      }),
    me: () => client.request<MeResult>('/auth/me'),
    logout: async () => {
      await client.request<MeResult>('/auth/logout', { method: 'POST' });
    },
  };
}
