/**
 * Shared application plumbing for ride request decisions (Phase 3.6).
 *
 * Both decision use cases (`accept-ride-request.ts`, `reject-ride-request.ts`)
 * share: the actor/request input shape, the Prisma-free persistence port, and
 * the default transaction wiring. This follows the Phase 3.5 pattern
 * (`create-ride-request.ts`): all Prisma details stay in the repository, the
 * application layer depends only on this shape, and the whole decision runs
 * inside a single `prisma.$transaction`.
 *
 * The critical safety property is the **ride row lock**: every decision for a
 * ride serializes on `SELECT ... FOR UPDATE` of that ride, so concurrent
 * accepts/rejects for the same ride are processed one at a time and always
 * re-read the current state (see `docs/development/phase-3-6-notes.md`).
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
  classifyRideRequestError,
  countConfirmedParticipantSeats,
  findParticipantByRequest,
  findRideRequest,
  lockRideForDecision,
  persistRideParticipant,
  persistRideStatusHistory,
  updateRideRequestStatus,
  updateRideStatus,
  type LockedRideRow,
  type PersistedRideParticipant,
  type PersistedRideRequest,
} from '../infrastructure/ride.repository.js';

/** The creator's trusted input for a request decision. */
export interface RideRequestDecisionInput {
  requestId: string;
  /** The acting user. Authentication is a later phase; this is trusted input. */
  actorId: string;
}

/**
 * Persistence port used by both decision use cases, implemented by the
 * infrastructure layer inside a single database transaction. No Prisma types
 * appear here beyond enum values and the repository's row shapes — the
 * application layer depends only on this interface.
 */
export interface RideRequestDecisionPersistence {
  /** Loads a request by id (used to find the ride, and re-read after locking). */
  findRequest(requestId: string): Promise<PersistedRideRequest | null>;
  /** Locks the ride row (SELECT ... FOR UPDATE), returning null when missing. */
  lockRideForDecision(rideId: string): Promise<LockedRideRow | null>;
  /** Sum of seats allocated to the ride's CONFIRMED participants. */
  countConfirmedSeats(rideId: string): Promise<number>;
  /** Existing participant for the request (defense-in-depth duplicate check). */
  findParticipantByRequest(requestId: string): Promise<{ id: string } | null>;
  /** Creates the RideParticipant for an accepted request. */
  createParticipant(params: {
    rideId: string;
    userId: string;
    requestId: string;
    seatsAllocated: number;
    status: ParticipantStatus;
  }): Promise<PersistedRideParticipant>;
  /** Moves the request to its terminal decision status. */
  updateRequestStatus(params: {
    requestId: string;
    status: RideRequestStatus;
    resolvedAt: Date;
  }): Promise<PersistedRideRequest>;
  /** Updates the ride status (first-accept PUBLISHED → CONFIRMED). */
  updateRideStatus(params: {
    rideId: string;
    status: RideStatus;
  }): Promise<{ id: string; status: RideStatus }>;
  /** Appends a RideStatusHistory row. */
  createStatusHistory(params: {
    rideId: string;
    fromStatus: RideStatus | null;
    toStatus: RideStatus;
    changedByUserId: string;
    reason: string;
  }): Promise<{ id: string }>;
  /**
   * Creates a notification in the SAME transaction (Phase 3.8): a decision's
   * notification commits/rolls back with the decision's state change.
   */
  createNotification(
    params: NotificationCreationParams,
  ): Promise<{ id: string }>;
  /** Classifies Prisma errors so races/FK failures map to app errors. */
  classifyError(err: unknown): 'unique' | 'foreign_key' | null;
}

/** Injected dependency so decision use cases are unit-testable without DB. */
export interface RideRequestDecisionDependencies {
  runTransaction: <T>(
    work: (persistence: RideRequestDecisionPersistence) => Promise<T>,
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

/** Application-level input shape checks shared by accept and reject. */
export function assertValidDecisionInput(
  input: RideRequestDecisionInput,
): void {
  if (typeof input.requestId !== 'string' || input.requestId.trim() === '') {
    throw new ValidationError('requestId is required', { field: 'requestId' });
  }
  if (typeof input.actorId !== 'string' || input.actorId.trim() === '') {
    throw new ValidationError('actorId is required', { field: 'actorId' });
  }
}

/** Builds the persistence port bound to one transaction client. */
export function createRideRequestDecisionPersistence(
  tx: Prisma.TransactionClient,
): RideRequestDecisionPersistence {
  return {
    findRequest: (requestId) => findRideRequest(tx, requestId),
    lockRideForDecision: (rideId) => lockRideForDecision(tx, rideId),
    countConfirmedSeats: (rideId) => countConfirmedParticipantSeats(tx, rideId),
    findParticipantByRequest: (requestId) =>
      findParticipantByRequest(tx, requestId),
    createParticipant: (params) => persistRideParticipant(tx, params),
    updateRequestStatus: (params) => updateRideRequestStatus(tx, params),
    updateRideStatus: (params) => updateRideStatus(tx, params),
    createStatusHistory: (params) => persistRideStatusHistory(tx, params),
    createNotification: (params) => persistNotification(tx, params),
    classifyError: classifyRideRequestError,
  };
}

/** Default dependency wiring: a single interactive `prisma.$transaction`. */
export function defaultRideRequestDecisionDependencies(): RideRequestDecisionDependencies {
  return {
    runTransaction: (work) =>
      prisma.$transaction(async (tx) =>
        work(createRideRequestDecisionPersistence(tx)),
      ),
    publishEvents: publishDrafts,
    publishPush: async (drafts) => {
      await getPushNotificationDispatcher().dispatch(drafts);
    },
  };
}
