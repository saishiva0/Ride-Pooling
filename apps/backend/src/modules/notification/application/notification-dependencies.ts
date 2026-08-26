/**
 * Shared application plumbing for notifications (Phase 3.8).
 *
 * All notification application services (`create-notification.ts`,
 * `list-notifications.ts`, `mark-notification-as-read.ts`,
 * `mark-all-notifications-as-read.ts`) share: the Prisma-free persistence
 * port, and the default transaction wiring. This follows the Ride Engine
 * pattern (`ride-request-decision.ts`, `ride-lifecycle.ts`): all Prisma
 * details stay in the repository, the application layer depends only on this
 * shape, and mutations run inside a single `prisma.$transaction`.
 *
 * The Ride Engine writes notifications through its OWN persistence ports using
 * `persistNotification` bound to the SAME transaction client, so notification
 * persistence is atomic with the Ride Engine state change (Phase 3.8 §10).
 */
import type { NotificationType, Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import {
  countUnreadNotifications,
  findNotificationById,
  findNotificationRecipient,
  findNotificationsForRecipient,
  markAllNotificationsRead,
  markNotificationRead,
  persistNotification,
  classifyNotificationError,
  type NotificationCreationParams,
  type NotificationRow,
} from '../infrastructure/notification.repository.js';

export type {
  NotificationCreationParams,
  NotificationRow,
} from '../infrastructure/notification.repository.js';

/**
 * A notification shaped for application-layer consumers (used by create,
 * list, and read-state updates). Never exposes raw Prisma records.
 */
export interface AppNotification {
  id: string;
  /** The user who received this notification. */
  recipientUserId: string;
  type: NotificationType;
  title: string | null;
  body: string | null;
  /** True when the notification has been read (readAt set). */
  read: boolean;
  readAt: Date | null;
  rideId: string | null;
  requestId: string | null;
  createdAt: Date;
}

/** Maps a persisted row to the application-layer shape. */
export function toAppNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    recipientUserId: row.userId,
    type: row.type,
    title: row.title,
    body: row.body,
    read: row.readAt !== null,
    readAt: row.readAt,
    rideId: row.rideId,
    requestId: row.requestId,
    createdAt: row.createdAt,
  };
}

/**
 * Persistence port used by the notification application services, implemented
 * by the infrastructure layer inside a single database transaction. No Prisma
 * types appear here beyond enum values and the repository's row shape.
 */
export interface NotificationPersistence {
  /** Looks up the recipient user (identity check before creating). */
  findRecipient(userId: string): Promise<{ id: string; name: string } | null>;
  /** Creates one notification. */
  createNotification(
    params: NotificationCreationParams,
  ): Promise<NotificationRow>;
  /** Loads a notification by id (read-state updates). */
  findNotificationById(id: string): Promise<NotificationRow | null>;
  /** Lists a recipient's notifications, newest first. */
  listNotifications(params: {
    userId: string;
    limit: number;
  }): Promise<NotificationRow[]>;
  /** Counts a recipient's unread notifications. */
  countUnreadNotifications(userId: string): Promise<number>;
  /** Marks one owned, unread notification read. */
  markNotificationRead(params: {
    id: string;
    userId: string;
    readAt: Date;
  }): Promise<{ count: number }>;
  /** Marks all of a recipient's unread notifications read. */
  markAllNotificationsRead(params: {
    userId: string;
    readAt: Date;
  }): Promise<{ count: number }>;
  /** Classifies Prisma errors so vanished-row/FK races map to app errors. */
  classifyError(err: unknown): 'foreign_key' | null;
}

/** Injected dependency so notification services are unit-testable without DB. */
export interface NotificationDependencies {
  runTransaction: <T>(
    work: (persistence: NotificationPersistence) => Promise<T>,
  ) => Promise<T>;
}

/** Builds the persistence port bound to one transaction client. */
export function createNotificationPersistence(
  tx: Prisma.TransactionClient,
): NotificationPersistence {
  return {
    findRecipient: (userId) => findNotificationRecipient(tx, userId),
    createNotification: (params) => persistNotification(tx, params),
    findNotificationById: (id) => findNotificationById(tx, id),
    listNotifications: (params) => findNotificationsForRecipient(tx, params),
    countUnreadNotifications: (userId) => countUnreadNotifications(tx, userId),
    markNotificationRead: (params) => markNotificationRead(tx, params),
    markAllNotificationsRead: (params) => markAllNotificationsRead(tx, params),
    classifyError: classifyNotificationError,
  };
}

/** Default dependency wiring: a single interactive `prisma.$transaction`. */
export function defaultNotificationDependencies(): NotificationDependencies {
  return {
    runTransaction: (work) =>
      prisma.$transaction(async (tx) =>
        work(createNotificationPersistence(tx)),
      ),
  };
}
