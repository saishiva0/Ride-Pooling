/**
 * Shared application plumbing for ride request / participation cancellation
 * (Phase 3.21).
 *
 * The cancellation use case (`cancel-ride-request.ts`) depends on a
 * Prisma-free persistence port plus default transaction wiring, following the
 * Phase 3.5/3.6/3.7 pattern (`ride-request-decision.ts`, `ride-lifecycle.ts`):
 * all Prisma details stay in the repository, the application layer depends
 * only on this shape, and the whole operation runs inside a single
 * `prisma.$transaction`.
 *
 * The critical safety property is the **ride row lock**: the cancellation
 * shares the Phase 3.6 `lockRideForDecision` (`SELECT ... FOR UPDATE`), so it
 * serializes with every other decision/lifecycle operation for the same ride
 * and always re-reads the current state.
 */
import type {
  ParticipantStatus,
  Prisma,
  RideRequestStatus,
  RideStatus,
} from '@prisma/client';
import { ValidationError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { persistNotification } from '../../notification/infrastructure/notification.repository.js';
import type { NotificationCreationParams } from '../../notification/infrastructure/notification.repository.js';
import type { NotificationDraft } from '../../notification/application/notification-mapping.js';
import { publishDrafts } from '../../realtime/application/event-publisher.js';
import { getPushNotificationDispatcher } from '../../realtime/application/push-publisher.js';
import {
  cancelRideParticipant,
  classifyRideCancellationError,
  countConfirmedParticipantSeats,
  findParticipantForCancellation,
  findRideRequest,
  lockRideForDecision,
  persistRideStatusHistory,
  updateRideRequestStatus,
  updateRideStatus,
  type CancelableParticipantRow,
  type LockedRideRow,
  type PersistedRideRequest,
} from '../infrastructure/ride.repository.js';

/** The participant's trusted input for cancellation. */
export interface RideRequestCancellationInput {
  requestId: string;
  /** The acting user (the requester / participant). Trusted input. */
  actorId: string;
}

/**
 * Persistence port used by the cancellation use case, implemented by the
 * infrastructure layer inside a single database transaction. No Prisma types
 * appear here beyond enum values and the repository's row shapes.
 */
export interface RideRequestCancellationPersistence {
  /** Loads a request by id (used to find the ride, and re-read after locking). */
  findRequest(requestId: string): Promise<PersistedRideRequest | null>;
  /** Locks the ride row (SELECT ... FOR UPDATE), returning null when missing. */
  lockRideForDecision(rideId: string): Promise<LockedRideRow | null>;
  /** The participant for the request (only exists when the request was ACCEPTED). */
  findParticipantForCancellation(
    requestId: string,
  ): Promise<CancelableParticipantRow | null>;
  /** Sum of seats allocated to the ride's CONFIRMED participants. */
  countConfirmedSeats(rideId: string): Promise<number>;
  /** Marks the participant CANCELLED (frees its seats) and stamps cancelledAt. */
  updateParticipantStatus(params: {
    id: string;
    cancelledAt: Date;
  }): Promise<{ id: string; status: ParticipantStatus }>;
  /** Moves the request to its terminal CANCELLED status. */
  updateRequestStatus(params: {
    requestId: string;
    status: RideRequestStatus;
    resolvedAt: Date;
  }): Promise<PersistedRideRequest>;
  /** Updates the ride status (last-participant CONFIRMED → PUBLISHED revert). */
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
  /**
   * Creates a notification in the SAME transaction (Phase 3.8): a
   * cancellation's notification commits/rolls back with its state change.
   */
  createNotification(
    params: NotificationCreationParams,
  ): Promise<{ id: string }>;
  /** Classifies Prisma errors so vanished rows/races map to app errors. */
  classifyError(err: unknown): 'not_found' | 'foreign_key' | null;
}

/** Injected dependency so the cancellation use case is unit-testable without DB. */
export interface RideRequestCancellationDependencies {
  runTransaction: <T>(
    work: (persistence: RideRequestCancellationPersistence) => Promise<T>,
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

/** Application-level input shape checks shared by withdrawal and cancellation. */
export function assertValidCancellationInput(
  input: RideRequestCancellationInput,
): void {
  if (typeof input.requestId !== 'string' || input.requestId.trim() === '') {
    throw new ValidationError('requestId is required', { field: 'requestId' });
  }
  if (typeof input.actorId !== 'string' || input.actorId.trim() === '') {
    throw new ValidationError('actorId is required', { field: 'actorId' });
  }
}

/** Builds the persistence port bound to one transaction client. */
export function createRideRequestCancellationPersistence(
  tx: Prisma.TransactionClient,
): RideRequestCancellationPersistence {
  return {
    findRequest: (requestId) => findRideRequest(tx, requestId),
    lockRideForDecision: (rideId) => lockRideForDecision(tx, rideId),
    findParticipantForCancellation: (requestId) =>
      findParticipantForCancellation(tx, requestId),
    countConfirmedSeats: (rideId) => countConfirmedParticipantSeats(tx, rideId),
    updateParticipantStatus: (params) => cancelRideParticipant(tx, params),
    updateRequestStatus: (params) => updateRideRequestStatus(tx, params),
    updateRideStatus: (params) => updateRideStatus(tx, params),
    createStatusHistory: (params) => persistRideStatusHistory(tx, params),
    createNotification: (params) => persistNotification(tx, params),
    classifyError: classifyRideCancellationError,
  };
}

/** Default dependency wiring: a single interactive `prisma.$transaction`. */
export function defaultRideRequestCancellationDependencies(): RideRequestCancellationDependencies {
  return {
    runTransaction: (work) =>
      prisma.$transaction(async (tx) =>
        work(createRideRequestCancellationPersistence(tx)),
      ),
    publishEvents: publishDrafts,
    publishPush: async (drafts) => {
      await getPushNotificationDispatcher().dispatch(drafts);
    },
  };
}
