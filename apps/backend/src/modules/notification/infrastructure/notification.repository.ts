/**
 * Notification persistence (Phase 3.8).
 *
 * The only persistence concern this module owns: creating notifications,
 * listing them for a recipient, and updating read state. These functions run
 * inside the caller's transaction (the transaction client is passed in) —
 * including inside Ride Engine transactions, so a notification is committed
 * atomically with the Ride Engine state change that produced it.
 *
 * The `Notification` model already exists from Phase 2 (`schema.prisma` §2.7,
 * `migration.sql`): no schema change was required. Its `userId` FK is
 * `ON DELETE RESTRICT` (a user with notifications cannot be deleted first)
 * while `rideId` / `requestId` FKs are `ON DELETE SET NULL`, which the
 * integration test cleanups account for.
 */
import { NotificationType, Prisma } from '@prisma/client';

/** The raw persisted notification row returned to callers. */
export interface NotificationRow {
  id: string;
  userId: string;
  type: NotificationType;
  title: string | null;
  body: string | null;
  readAt: Date | null;
  rideId: string | null;
  requestId: string | null;
  createdAt: Date;
}

/**
 * Everything required to persist a notification. `rideId` / `requestId` are
 * optional context references (both FKs are `SET NULL` on delete). This is the
 * shape the Ride Engine persistence ports expose too, so notification creation
 * can be wired into Ride Engine transactions.
 */
export interface NotificationCreationParams {
  userId: string;
  type: NotificationType;
  title: string | null;
  body: string | null;
  rideId?: string | null;
  requestId?: string | null;
}

const NOTIFICATION_SELECT = {
  id: true,
  userId: true,
  type: true,
  title: true,
  body: true,
  readAt: true,
  rideId: true,
  requestId: true,
  createdAt: true,
} as const;

/** Inserts a notification inside the caller's transaction. */
export async function persistNotification(
  tx: Prisma.TransactionClient,
  params: NotificationCreationParams,
): Promise<NotificationRow> {
  return tx.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      rideId: params.rideId ?? null,
      requestId: params.requestId ?? null,
    },
    select: NOTIFICATION_SELECT,
  });
}

/** Loads a notification by id (used for read-state updates). */
export async function findNotificationById(
  client: Prisma.TransactionClient,
  id: string,
): Promise<NotificationRow | null> {
  return client.notification.findUnique({
    where: { id },
    select: NOTIFICATION_SELECT,
  });
}

/**
 * Lists a recipient's notifications, newest first. Ordering is deterministic
 * even for equal `createdAt` timestamps via an `id` tiebreak. `limit` rows are
 * fetched plus one sentinel so callers can report `hasMore`.
 */
export async function findNotificationsForRecipient(
  client: Prisma.TransactionClient,
  params: { userId: string; limit: number },
): Promise<NotificationRow[]> {
  return client.notification.findMany({
    where: { userId: params.userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit,
    select: NOTIFICATION_SELECT,
  });
}

/** Counts a recipient's unread notifications (readAt IS NULL). */
export async function countUnreadNotifications(
  client: Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  return client.notification.count({ where: { userId, readAt: null } });
}

/**
 * Marks one notification read, but only when it is still unread and owned by
 * `userId`. An `updateMany` (rather than `update`) makes this race-safe: a row
 * that was already read (or no longer exists, or belongs to someone else)
 * simply matches zero rows. Returns the number of rows updated.
 */
export async function markNotificationRead(
  tx: Prisma.TransactionClient,
  params: { id: string; userId: string; readAt: Date },
): Promise<{ count: number }> {
  const result = await tx.notification.updateMany({
    where: { id: params.id, userId: params.userId, readAt: null },
    data: { readAt: params.readAt },
  });
  return { count: result.count };
}

/**
 * Marks all of a recipient's unread notifications read in a single efficient
 * operation. Already-read notifications are never touched (the `readAt: null`
 * predicate), so the operation is naturally idempotent. Returns the number of
 * rows updated.
 */
export async function markAllNotificationsRead(
  client: Prisma.TransactionClient,
  params: { userId: string; readAt: Date },
): Promise<{ count: number }> {
  const result = await client.notification.updateMany({
    where: { userId: params.userId, readAt: null },
    data: { readAt: params.readAt },
  });
  return { count: result.count };
}

/** Looks up a notification recipient by id (identity check for the FK). */
export async function findNotificationRecipient(
  client: Prisma.TransactionClient,
  userId: string,
): Promise<{ id: string; name: string } | null> {
  return client.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true },
  });
}

/**
 * Classifies a Prisma error thrown by a notification insert so the
 * application layer can translate races/FK violations into its own error
 * structure (never a raw Prisma error):
 *
 * - `foreign_key` → the recipient/ride/request vanished between validation
 *   and insert (P2003).
 * - `null` → anything else.
 */
export function classifyNotificationError(err: unknown): 'foreign_key' | null {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2003'
  ) {
    return 'foreign_key';
  }
  return null;
}
