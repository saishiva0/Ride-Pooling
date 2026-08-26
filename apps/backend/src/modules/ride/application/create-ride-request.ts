/**
 * Ride request creation use case (Phase 3.5 — RIDE REQUESTS).
 *
 * Creates a `PENDING` RideRequest for an eligible ride. This phase is request
 * lifecycle creation only: it validates, enforces the documented request
 * rules, and persists the request. It does NOT accept/reject requests, create
 * participants, or reserve seats (those are Phase 3.6).
 *
 * Flow (all inside one transaction — consistent snapshot, single atomic
 * write):
 *
 *   validate input shape
 *   → find requester (Not Found → NotFoundError)
 *   → find ride + live available seats (Not Found → NotFoundError)
 *   → self-request rule (creator → BusinessRuleError)
 *   → requestable-state rule (DRAFT/terminal/IN_PROGRESS → BusinessRuleError)
 *   → seat rule (requested > available → BusinessRuleError)
 *   → duplicate active request (PENDING/ACCEPTED exists → ConflictError)
 *   → insert PENDING request (races on the DB partial unique index →
 *     translated to ConflictError; never a raw Prisma error)
 *   → typed result
 *
 * Business rules live in `domain/request-rules.ts`; all persistence/Prisma
 * details live in the repository. This module has no HTTP/Express, no
 * authentication (requesterId is a trusted input), and no notifications.
 */
import { RideRequestStatus } from '@prisma/client';
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { persistNotification } from '../../notification/infrastructure/notification.repository.js';
import type { NotificationCreationParams } from '../../notification/infrastructure/notification.repository.js';
import {
  newRideRequestDrafts,
  persistNotificationDrafts,
  type NotificationDraft,
} from '../../notification/application/notification-mapping.js';
import { publishDrafts } from '../../realtime/application/event-publisher.js';
import { isBlockedPair } from '../../safety/application/block-check.js';
import {
  hasSufficientSeats,
  isRequestableRideStatus,
  isValidRequestedSeats,
} from '../domain/request-rules.js';
import {
  findActiveRideRequest,
  findRequester,
  findRideForRequest,
  persistRideRequest,
  classifyRideRequestError,
  type PersistedRideRequest,
  type RequestableRideRow,
} from '../infrastructure/ride.repository.js';

export type { RequestableRideRow } from '../infrastructure/ride.repository.js';

/** The initial request state (`docs/domain/ride-lifecycle.md` §6). */
export const INITIAL_RIDE_REQUEST_STATUS = RideRequestStatus.PENDING;

/**
 * The requester's trusted input for request creation. `requesterId` is
 * supplied explicitly for now — authentication will be connected later at
 * the API boundary (Phase 3.5 §20).
 */
export interface RideRequestInput {
  rideId: string;
  requesterId: string;
  /** Optional requested seat count (≥ 1); defaults to 1 (domain-model.md §2.3). */
  requestedSeats?: number;
}

/** The created request, shaped for application-layer consumers. */
export interface CreatedRideRequest {
  id: string;
  rideId: string;
  requester: { id: string; name: string };
  requestedSeats: number;
  status: RideRequestStatus;
  createdAt: Date;
}

/**
 * Persistence port used by `createRideRequest`, implemented by the
 * infrastructure layer inside a single database transaction. No Prisma types
 * appear here — the application layer depends only on this shape.
 */
export interface RideRequestPersistence {
  findRequester(userId: string): Promise<{ id: string; name: string } | null>;
  findRideForRequest(rideId: string): Promise<RequestableRideRow | null>;
  findActiveRequest(
    rideId: string,
    userId: string,
  ): Promise<{ id: string } | null>;
  createRequest(params: {
    rideId: string;
    userId: string;
    requestedSeats: number;
    status: RideRequestStatus;
  }): Promise<PersistedRideRequest>;
  /**
   * Creates a notification in the SAME transaction (Phase 3.8): the request's
   * notification commits/rolls back with the request insert.
   */
  createNotification(
    params: NotificationCreationParams,
  ): Promise<{ id: string }>;
  classifyError(err: unknown): 'unique' | 'foreign_key' | null;
}

/** Injected dependency so the use case is unit-testable without PostgreSQL. */
export interface CreateRideRequestDependencies {
  runTransaction: <T>(
    work: (persistence: RideRequestPersistence) => Promise<T>,
  ) => Promise<T>;
  /**
   * Post-transaction realtime publishing (Phase 3.11). Called ONLY after the
   * transaction has committed; the default routes drafts through the active
   * `EventPublisher` (no-op until a Socket.io server activates).
   */
  publishEvents?: (drafts: readonly NotificationDraft[]) => Promise<void>;
  /**
   * Cross-module read (Phase 3.24 — Reporting & Blocking, §13 — DECIDED): a
   * requester with an active block against the ride's creator (either
   * direction) cannot submit a new request, going forward from the moment
   * of blocking. Defaults to the `safety` module's `isBlockedPair`.
   */
  isBlockedPair?: (userA: string, userB: string) => Promise<boolean>;
}

function defaultDependencies(): CreateRideRequestDependencies {
  return {
    runTransaction: (work) =>
      prisma.$transaction(async (tx) =>
        work({
          findRequester: (userId) => findRequester(tx, userId),
          findRideForRequest: (rideId) => findRideForRequest(tx, rideId),
          findActiveRequest: (rideId, userId) =>
            findActiveRideRequest(tx, rideId, userId),
          createRequest: (params) => persistRideRequest(tx, params),
          createNotification: (params) => persistNotification(tx, params),
          classifyError: classifyRideRequestError,
        }),
      ),
    publishEvents: publishDrafts,
    isBlockedPair,
  };
}

/**
 * Application-level input shape checks. Coordinate/ride field rules are not
 * involved here; only the request shape is validated.
 */
function assertValidRequestInput(input: RideRequestInput): void {
  if (typeof input.rideId !== 'string' || input.rideId.trim() === '') {
    throw new ValidationError('rideId is required', { field: 'rideId' });
  }
  if (
    typeof input.requesterId !== 'string' ||
    input.requesterId.trim() === ''
  ) {
    throw new ValidationError('requesterId is required', {
      field: 'requesterId',
    });
  }
  const requestedSeats = input.requestedSeats ?? 1;
  if (!isValidRequestedSeats(requestedSeats)) {
    throw new ValidationError('requestedSeats must be a positive integer', {
      field: 'requestedSeats',
      details: { requestedSeats },
    });
  }
}

function toCreatedRideRequest(
  record: PersistedRideRequest,
  requester: { id: string; name: string },
): CreatedRideRequest {
  return {
    id: record.id,
    rideId: record.rideId,
    requester: { id: requester.id, name: requester.name },
    requestedSeats: record.requestedSeats,
    status: record.status,
    createdAt: record.createdAt,
  };
}

/**
 * Creates a `PENDING` request to join a ride.
 *
 * Atomic: the entire flow runs in one transaction, so a failed rule or write
 * never leaves partial request data, and the duplicate-request race is
 * ultimately settled by the database partial unique index (translated here
 * into a `ConflictError`).
 *
 * Throws `ValidationError` (malformed input), `NotFoundError` (missing
 * requester/ride), `BusinessRuleError` (self-request / non-requestable ride /
 * insufficient seats), or `ConflictError` (duplicate active request).
 */
export async function createRideRequest(
  input: RideRequestInput,
  deps: Partial<CreateRideRequestDependencies> = {},
): Promise<CreatedRideRequest> {
  const {
    runTransaction,
    publishEvents,
    isBlockedPair: checkBlockedPair,
  } = {
    ...defaultDependencies(),
    ...deps,
  };

  assertValidRequestInput(input);
  const requestedSeats = input.requestedSeats ?? 1;

  const outcome = await runTransaction(async (persistence) => {
    const requester = await persistence.findRequester(input.requesterId);
    if (!requester) {
      throw new NotFoundError('Requester not found', {
        field: 'requesterId',
        details: { requesterId: input.requesterId },
      });
    }

    const ride = await persistence.findRideForRequest(input.rideId);
    if (!ride) {
      throw new NotFoundError('Ride not found', {
        field: 'rideId',
        details: { rideId: input.rideId },
      });
    }

    if (requester.id === ride.creatorId) {
      throw new BusinessRuleError(
        'A ride creator cannot request their own ride',
        {
          field: 'rideId',
          details: { rideId: input.rideId },
        },
      );
    }

    // Phase 3.24 (Reporting & Blocking, §13 — DECIDED): an active block
    // between the requester and the ride's creator (either direction)
    // blocks new requests going forward. The message is deliberately
    // generic — it never discloses to either party that a block exists
    // (§12/§16 — DECIDED, fully silent).
    if (await checkBlockedPair?.(requester.id, ride.creatorId)) {
      throw new BusinessRuleError('This ride is not available to request', {
        field: 'rideId',
        details: { rideId: input.rideId },
      });
    }

    if (!isRequestableRideStatus(ride.status)) {
      throw new BusinessRuleError(
        `Ride is not open to requests in status ${ride.status}`,
        {
          field: 'rideId',
          details: { rideId: input.rideId, status: ride.status },
        },
      );
    }

    if (!hasSufficientSeats(requestedSeats, ride.availableSeats)) {
      throw new BusinessRuleError(
        'Requested seats exceed the currently available seats',
        {
          field: 'requestedSeats',
          details: {
            requestedSeats,
            availableSeats: ride.availableSeats,
          },
        },
      );
    }

    const existing = await persistence.findActiveRequest(
      input.rideId,
      requester.id,
    );
    if (existing) {
      throw new ConflictError(
        'You already have an active request for this ride',
        {
          field: 'rideId',
          details: { rideId: input.rideId },
        },
      );
    }

    try {
      const record = await persistence.createRequest({
        rideId: input.rideId,
        userId: requester.id,
        requestedSeats,
        status: INITIAL_RIDE_REQUEST_STATUS,
      });
      // Phase 3.8: RIDE_REQUESTED → the ride creator, committed atomically
      // with the request insert (Phase 3.8 §9–§10).
      const drafts = newRideRequestDrafts({
        rideId: record.rideId,
        requestId: record.id,
        creatorId: ride.creatorId,
        requesterName: requester.name,
      });
      await persistNotificationDrafts(persistence.createNotification, drafts);
      return { result: toCreatedRideRequest(record, requester), drafts };
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      const kind = persistence.classifyError(err);
      if (kind === 'unique') {
        throw new ConflictError(
          'You already have an active request for this ride',
          {
            field: 'rideId',
            details: { rideId: input.rideId },
          },
        );
      }
      if (kind === 'foreign_key') {
        throw new NotFoundError('Requester or ride not found', {
          field: 'rideId',
          details: { rideId: input.rideId },
        });
      }
      throw new InternalError('Failed to create ride request', { cause: err });
    }
  });

  // Phase 3.11: publish AFTER the transaction committed. If the transaction
  // failed/rolled back, this line is never reached — no event is emitted.
  await publishEvents?.(outcome.drafts);
  return outcome.result;
}
