/**
 * Ride completion use case (Phase 3.17 — COMPLETE).
 *
 * The ride creator completes an in-progress ride (IN_PROGRESS → COMPLETED,
 * `docs/domain/ride-lifecycle.md` §2.5; PRD FR-014). COMPLETED is a terminal
 * state — no further transitions are possible (`ride-state-machine.ts`).
 *
 * Flow (one transaction, Phase 3.7 lifecycle convention):
 *
 *   validate input shape
 *   → LOCK the ride row (SELECT ... FOR UPDATE)
 *   → ride must exist (else NotFoundError)
 *   → actor must be the ride creator (else AuthorizationError)
 *   → ride status must be completable (else BusinessRuleError)
 *   → transitionRideStatus(status, COMPLETED)   [Phase 3.1 state machine]
 *   → update ride → COMPLETED
 *   → write RideStatusHistory (fromStatus, toStatus COMPLETED,
 *     changedByUserId = actor, meaningful reason)
 *   → typed result
 *
 * Notification behavior: the existing Phase 3.8 mapping defines six events
 * and NO draft exists for RIDE_COMPLETED (`notification-mapping.ts`). Per the
 * canonical Phase 3.17 spec (§9), completing creates NO notification and NO
 * realtime event. Do not invent one.
 *
 * Completing a ride that is not IN_PROGRESS (e.g. still PUBLISHED, or already
 * COMPLETED) fails with `BusinessRuleError` — no duplicate history rows.
 */
import { RideStatus } from '@prisma/client';
import {
  AppError,
  AuthorizationError,
  BusinessRuleError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import { canCompleteRide } from '../domain/lifecycle-rules.js';
import { transitionRideStatus } from '../domain/ride-state-machine.js';
import {
  defaultRideLifecycleDependencies,
  type RideLifecycleDependencies,
} from './ride-lifecycle.js';

/** History reason for a creator completion (`ride-lifecycle.md` §2.5). */
export const RIDE_COMPLETED_REASON = 'Ride completed by creator';

/** The creator's trusted input for completing. */
export interface CompleteRideInput {
  rideId: string;
  /** The acting user. Authentication is a later phase; this is trusted input. */
  actorId: string;
}

/** The completed ride, shaped for application-layer consumers. */
export interface CompletedRide {
  rideId: string;
  status: RideStatus;
  /** The moment the ride was completed (the transaction's decision time). */
  completedAt: Date;
}

/** Application-level input shape checks for completing. */
function assertValidCompleteInput(input: CompleteRideInput): void {
  if (typeof input.rideId !== 'string' || input.rideId.trim() === '') {
    throw new ValidationError('rideId is required', { field: 'rideId' });
  }
  if (typeof input.actorId !== 'string' || input.actorId.trim() === '') {
    throw new ValidationError('actorId is required', { field: 'actorId' });
  }
}

/**
 * Completes an IN_PROGRESS ride owned by the actor.
 *
 * Throws `ValidationError` (malformed input), `NotFoundError` (missing ride),
 * `AuthorizationError` (actor is not the ride creator), or
 * `BusinessRuleError` (ride status cannot be completed — e.g. still PUBLISHED
 * or already COMPLETED). Completion is therefore idempotent-proof: completing
 * an already-completed ride fails with `BusinessRuleError` rather than
 * writing a duplicate history row.
 */
export async function completeRide(
  input: CompleteRideInput,
  deps: Partial<RideLifecycleDependencies> = {},
): Promise<CompletedRide> {
  const { runTransaction, publishEvents } = {
    ...defaultRideLifecycleDependencies(),
    ...deps,
  };

  assertValidCompleteInput(input);

  const outcome = await runTransaction(async (persistence) => {
    // 1. Lock the ride row — serializes completion with every other lifecycle
    //    operation for the ride.
    const ride = await persistence.lockRide(input.rideId);
    if (!ride) {
      throw new NotFoundError('Ride not found', {
        field: 'rideId',
        details: { rideId: input.rideId },
      });
    }

    // 2. Creator authorization (business-level; auth is a later phase).
    if (ride.creatorId !== input.actorId) {
      throw new AuthorizationError(
        'Only the ride creator can complete this ride',
        {
          field: 'actorId',
          details: { rideId: ride.id },
        },
      );
    }

    // 3. Completable state — delegating to the state machine
    //    (`docs/domain/ride-lifecycle.md` §2.5).
    if (!canCompleteRide(ride.status)) {
      throw new BusinessRuleError(
        `Ride cannot be completed from status ${ride.status}`,
        {
          field: 'rideId',
          details: { rideId: ride.id, status: ride.status },
        },
      );
    }

    try {
      // 4. Produce the resulting state through the state machine.
      const resultingStatus = transitionRideStatus(
        ride.status,
        RideStatus.COMPLETED,
      );

      // 5. Atomic writes: ride status + status history. No notification is
      //    created (existing mapping has no RIDE_COMPLETED draft), so
      //    `drafts` is empty and no realtime event is published.
      await persistence.updateRideStatus({
        rideId: ride.id,
        status: resultingStatus,
      });
      await persistence.createStatusHistory({
        rideId: ride.id,
        fromStatus: ride.status,
        toStatus: resultingStatus,
        changedByUserId: input.actorId,
        reason: RIDE_COMPLETED_REASON,
      });

      return {
        result: {
          rideId: ride.id,
          status: resultingStatus,
          completedAt: new Date(),
        },
        drafts: [],
      };
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      const kind = persistence.classifyError(err);
      if (kind === 'not_found' || kind === 'foreign_key') {
        throw new NotFoundError('Ride not found', {
          field: 'rideId',
          details: { rideId: ride.id },
        });
      }
      throw new InternalError('Failed to complete ride', { cause: err });
    }
  });

  await publishEvents?.(outcome.drafts);
  return outcome.result;
}
