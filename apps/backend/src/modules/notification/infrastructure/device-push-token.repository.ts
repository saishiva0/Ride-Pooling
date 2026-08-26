/**
 * Device push token persistence (Phase 3.23).
 *
 * Manages DevicePushToken records — registration, lookup, deactivation,
 * and active token retrieval for push dispatch.
 */
import { Prisma } from '@prisma/client';

/** Raw DevicePushToken row from the database. */
export interface DevicePushTokenRow {
  id: string;
  userId: string;
  token: string;
  platform: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
}

/** Input for registering/updating a device token. */
export interface RegisterDeviceTokenParams {
  userId: string;
  token: string;
  platform: string;
}

const DEVICE_PUSH_TOKEN_SELECT = {
  id: true,
  userId: true,
  token: true,
  platform: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  lastSeenAt: true,
} as const;

/**
 * Registers or updates a device push token (idempotent).
 * If the token exists for the user, updates platform, reactivates, and refreshes lastSeenAt.
 * If the token exists for a different user, throws (foreign key constraint).
 */
export async function registerDeviceToken(
  tx: Prisma.TransactionClient,
  params: RegisterDeviceTokenParams,
): Promise<DevicePushTokenRow> {
  const now = new Date();

  return tx.devicePushToken.upsert({
    where: {
      userId_token: {
        userId: params.userId,
        token: params.token,
      },
    },
    create: {
      userId: params.userId,
      token: params.token,
      platform: params.platform,
      isActive: true,
      lastSeenAt: now,
    },
    update: {
      platform: params.platform,
      isActive: true,
      lastSeenAt: now,
    },
    select: DEVICE_PUSH_TOKEN_SELECT,
  });
}

/** Finds a device token by its token string (for deactivation). */
export async function findDeviceTokenByToken(
  client: Prisma.TransactionClient,
  token: string,
): Promise<DevicePushTokenRow | null> {
  return client.devicePushToken.findUnique({
    where: { token },
    select: DEVICE_PUSH_TOKEN_SELECT,
  });
}

/** Finds all active device tokens for a user. */
export async function findActiveDeviceTokensForUser(
  client: Prisma.TransactionClient,
  userId: string,
): Promise<DevicePushTokenRow[]> {
  return client.devicePushToken.findMany({
    where: { userId, isActive: true },
    select: DEVICE_PUSH_TOKEN_SELECT,
  });
}

/** Finds all device tokens for a user (for management UI). */
export async function findDeviceTokensForUser(
  client: Prisma.TransactionClient,
  userId: string,
): Promise<DevicePushTokenRow[]> {
  return client.devicePushToken.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: DEVICE_PUSH_TOKEN_SELECT,
  });
}

/** Deactivates a device token (soft delete — preserves history). */
export async function deactivateDeviceToken(
  tx: Prisma.TransactionClient,
  token: string,
): Promise<DevicePushTokenRow | null> {
  const existing = await tx.devicePushToken.findUnique({
    where: { token },
    select: { id: true },
  });

  if (!existing) return null;

  return tx.devicePushToken.update({
    where: { token },
    data: { isActive: false },
    select: DEVICE_PUSH_TOKEN_SELECT,
  });
}

/** Deactivates all device tokens for a user (logout cleanup). */
export async function deactivateAllDeviceTokensForUser(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  const result = await tx.devicePushToken.updateMany({
    where: { userId, isActive: true },
    data: { isActive: false },
  });
  return result.count;
}

/** Updates lastSeenAt for a token (periodic heartbeat). */
export async function updateDeviceTokenLastSeen(
  tx: Prisma.TransactionClient,
  token: string,
): Promise<DevicePushTokenRow | null> {
  const existing = await tx.devicePushToken.findUnique({
    where: { token },
    select: { id: true },
  });

  if (!existing) return null;

  return tx.devicePushToken.update({
    where: { token },
    data: { lastSeenAt: new Date() },
    select: DEVICE_PUSH_TOKEN_SELECT,
  });
}

/** Validates platform value. */
export function isValidPlatform(platform: string): boolean {
  return platform === 'android' || platform === 'ios';
}

/** Classifies Prisma errors for device token operations. */
export function classifyDeviceTokenError(
  err: unknown,
): 'foreign_key' | 'unique_constraint' | null {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2003'
  ) {
    return 'foreign_key';
  }
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002'
  ) {
    return 'unique_constraint';
  }
  return null;
}
