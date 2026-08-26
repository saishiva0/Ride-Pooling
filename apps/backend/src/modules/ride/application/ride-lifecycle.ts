/**
 * Shared application plumbing for ride lifecycle operations (Phase 3.7).
 *
 * Both lifecycle use cases (`cancel-ride.ts`, `expire-ride.ts`) share: the
 * Prisma-free persistence port, and the default transaction wiring. This
 * follows the Phase 3.5/3.6 pattern (`ride-request-decision.ts`): all Prisma
 * details stay in the repository, the application layer depends only on this
 * shape, and the whole operation runs inside a single `prisma.$transaction`.
 *
 * The critical safety property is the **ride row lock** (`lockRideForLifecycle`):
 * every lifecycle operation serializes on `SELECT ... FOR UPDATE` of the ride,
 * sharing the same ride-row lock as Phase 3.6 request decisions, so
 * cancellation/expiration cannot interleave with acceptance/rejection and
 * always re-read the current state (see `docs/development/phase-3-7-notes.md`).
 */
import type { Prisma, RideStatus } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import {
  classifyRideLifecycleError,
  findConfirmedParticipantUserIds,
  lockRideForLifecycle,
  persistRideStatusHistory,
  updateRideStatus,
  type LockedRideLifecycleRow,
} from '../infrastructure/ride.repository.js';
import { persistNotification } from '../../notification/infrastructure/notification.repository.js';
import type { NotificationCreationParams } from '../../notification/infrastructure/notification.repository.js';
import type { NotificationDraft } from '../../notification/application/notification-mapping.js';
import { publishDrafts } from '../../realtime/application/event-publisher.js';
import { getPushNotificationDispatcher } from '../../realtime/application/push-publisher.js';

/**
 * Persistence port used by both lifecycle use cases, implemented by the
 * infrastructure layer inside a single database transaction. No Prisma types
 * appear here beyond enum values and the repository's row shapes — the
 * application layer depends only on this interface.
 */
export interface RideLifecyclePersistence {
  /** Locks the ride row (SELECT ... FOR UPDATE), returning null when missing. */
  lockRide(rideId: string): Promise<LockedRideLifecycleRow | null>;
  /** Updates the ride status (cancel/expire transition write). */
  updateRideStatus(params: {
    rideId: string;
    status: RideStatus;
  }): Promise<{ id: string; status: RideStatus }>;
  /** Appends a RideStatusHistory row. */
  createStatusHistory(params: {
    rideId: string;
    fromStatus: RideStatus | null;
    toStatus: RideStatus;
    changedByUserId: string | null;
    reason: string;
  }): Promise<{ id: string }>;
  /** The userIds of the ride's CONFIRMED participants (notification targets). */
  findConfirmedParticipantIds(rideId: string): Promise<string[]>;
  /**
   * Creates a notification in the SAME transaction (Phase 3.8): a lifecycle
   * operation's notification commits/rolls back with its state change.
   */
  createNotification(
    params: NotificationCreationParams,
  ): Promise<{ id: string }>;
  /** Classifies Prisma errors so vanished rows/races map to app errors. */
  classifyError(err: unknown): 'not_found' | 'foreign_key' | null;
}

/** Injected dependency so lifecycle use cases are unit-testable without DB. */
export interface RideLifecycleDependencies {
  runTransaction: <T>(
    work: (persistence: RideLifecyclePersistence) => Promise<T>,
  ) => Promise<T>;
  /**
   * Post-transaction realtime publishing (Phase 3.11). Called ONLY after the
   * transaction has committed; the default routes drafts through the active
   * `EventPublisher` (no-op until a Socket.io server activates).
   */
  publishEvents?: (drafts: readonly NotificationDraft[]) => Promise<void>;
  /**
   * Post-transaction push notification dispatch (Phase 3.23). Called ONLY after
   * the transaction has committed and realtime events are published. Best-effort:
   * push failures are logged but never fail the operation.
   */
  publishPush?: (drafts: readonly NotificationDraft[]) => Promise<void>;
}

/** Builds the persistence port bound to one transaction client. */
export function createRideLifecyclePersistence(
  tx: Prisma.TransactionClient,
): RideLifecyclePersistence {
  return {
    lockRide: (rideId) => lockRideForLifecycle(tx, rideId),
    updateRideStatus: (params) => updateRideStatus(tx, params),
    createStatusHistory: (params) => persistRideStatusHistory(tx, params),
    findConfirmedParticipantIds: (rideId) =>
      findConfirmedParticipantUserIds(tx, rideId),
    createNotification: (params) => persistNotification(tx, params),
    classifyError: classifyRideLifecycleError,
  };
}

/** Default dependency wiring: a single interactive `prisma.$transaction`. */
export function defaultRideLifecycleDependencies(): RideLifecycleDependencies {
  return {
    runTransaction: (work) =>
      prisma.$transaction(async (tx) =>
        work(createRideLifecyclePersistence(tx)),
      ),
    publishEvents: publishDrafts,
    publishPush: async (drafts) => {
      await getPushNotificationDispatcher().dispatch(drafts);
    },
  };
}
