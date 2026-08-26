/**
 * Auth HTTP controllers (OD-005 — Phase 3.18).
 *
 * Thin by construction: read the request, parse HTTP input with Zod, call
 * ONE existing application service (or the session service), and envelope the
 * result. No Prisma, no repositories, no auth logic. The authenticated user
 * always comes from the auth boundary (`getAuthenticatedUser`); the presented
 * token is never echoed back. Errors are handled centrally.
 */
import type { Request, Response } from 'express';
import { parseRequest } from '../../api/parse.js';
import { sendData } from '../../api/response.js';
import { getAuthenticatedUser } from './auth.middleware.js';
import { getBearerToken } from './bearer-authenticator.js';
import { requestOtp } from '../application/request-otp.js';
import { verifyOtp } from '../application/verify-otp.js';
import type { AuthDependencies } from '../application/auth-dependencies.js';
import { requestOtpSchema, verifyOtpSchema } from './auth.schemas.js';

/** Handlers bound to the injected auth dependencies. */
export interface AuthController {
  requestOtp(req: Request, res: Response): Promise<void>;
  verifyOtp(req: Request, res: Response): Promise<void>;
  me(req: Request, res: Response): Promise<void>;
  logout(req: Request, res: Response): Promise<void>;
}

export function createAuthController(deps: AuthDependencies): AuthController {
  return {
    /** POST /api/v1/auth/request-otp — sends an OTP (generic response). */
    async requestOtp(req, res) {
      const { phone } = parseRequest(requestOtpSchema, req.body);
      const result = await requestOtp({ phone }, deps);
      sendData(res, 200, result);
    },

    /** POST /api/v1/auth/verify-otp — verifies the OTP and issues a session. */
    async verifyOtp(req, res) {
      const { phone, otp } = parseRequest(verifyOtpSchema, req.body);
      const result = await verifyOtp({ phone, otp }, deps);
      sendData(res, 200, result);
    },

    /** GET /api/v1/auth/me — the authenticated user. */
    async me(_req, res) {
      const identity = getAuthenticatedUser(res);
      sendData(res, 200, { user: { userId: identity.userId } });
    },

    /** POST /api/v1/auth/logout — revokes the presented session. */
    async logout(req, res) {
      const identity = getAuthenticatedUser(res);
      const token = getBearerToken(req);
      if (token) {
        await deps.sessionService.revoke(token);
      }
      sendData(res, 200, { user: { userId: identity.userId } });
    },
  };
}
