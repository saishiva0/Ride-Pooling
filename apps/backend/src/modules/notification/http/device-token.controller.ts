/**
 * Device token HTTP controller (Phase 3.23).
 *
 * Handles device push token registration and deactivation.
 * All endpoints require authentication — identity comes from middleware only.
 */
import { Request, Response } from 'express';
import { z } from 'zod';
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import { getAuthenticatedUser } from '../../auth/http/auth.middleware.js';
import { parseRequest } from '../../api/parse.js';
import { sendData } from '../../api/response.js';
import { prisma } from '../../../lib/prisma.js';
import {
  registerDeviceToken,
  findDeviceTokenByToken,
  deactivateDeviceToken,
  deactivateAllDeviceTokensForUser,
  findDeviceTokensForUser,
  classifyDeviceTokenError,
} from '../infrastructure/device-push-token.repository.js';

/** POST /api/v1/notifications/device-tokens — body. */
export const registerDeviceTokenSchema = z.object({
  token: z.string().trim().min(1),
  platform: z.enum(['android', 'ios']),
});

export type RegisterDeviceTokenRequest = z.infer<
  typeof registerDeviceTokenSchema
>;

export async function registerDeviceTokenHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { token, platform } = parseRequest(registerDeviceTokenSchema, req.body);
  const identity = getAuthenticatedUser(res);
  const userId = identity.userId;

  try {
    const deviceToken = await registerDeviceToken(prisma, {
      userId,
      token,
      platform,
    });

    sendData(res, 201, {
      id: deviceToken.id,
      token: deviceToken.token,
      platform: deviceToken.platform,
      isActive: deviceToken.isActive,
      createdAt: deviceToken.createdAt.toISOString(),
      updatedAt: deviceToken.updatedAt.toISOString(),
      lastSeenAt: deviceToken.lastSeenAt.toISOString(),
    });
  } catch (err) {
    const kind = classifyDeviceTokenError(err);
    if (kind === 'foreign_key') {
      throw new ValidationError('User not found', { field: 'userId' });
    }
    throw err;
  }
}

/** DELETE /api/v1/notifications/device-tokens/:token — path parameter. */
export const deactivateDeviceTokenSchema = z.object({
  token: z.string().trim().min(1),
});

export async function deactivateDeviceTokenHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { token } = parseRequest(deactivateDeviceTokenSchema, req.params);
  const identity = getAuthenticatedUser(res);
  const userId = identity.userId;

  const deviceToken = await findDeviceTokenByToken(prisma, token);
  if (!deviceToken) {
    throw new NotFoundError('Device token not found', { field: 'token' });
  }

  if (deviceToken.userId !== userId) {
    throw new AuthorizationError(
      "Cannot deactivate another user's device token",
    );
  }

  await deactivateDeviceToken(prisma, token);
  res.status(204).send();
}

/** DELETE /api/v1/notifications/device-tokens (deactivate all for current user) */
export async function deactivateAllDeviceTokensHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const userId = identity.userId;

  const count = await deactivateAllDeviceTokensForUser(prisma, userId);
  sendData(res, 200, { deactivatedCount: count });
}

/** GET /api/v1/notifications/device-tokens (list user's tokens) */
export async function listDeviceTokensHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const userId = identity.userId;

  const tokens = await findDeviceTokensForUser(prisma, userId);

  sendData(
    res,
    200,
    tokens.map((t) => ({
      id: t.id,
      token: t.token,
      platform: t.platform,
      isActive: t.isActive,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      lastSeenAt: t.lastSeenAt.toISOString(),
    })),
  );
}
