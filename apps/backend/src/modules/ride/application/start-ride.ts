/**
 * Ride start use case (Phase 3.17 — START).
 *
 * The ride creator starts an accepted ride (PUBLISHED | CONFIRMED →
 * IN_PROGRESS, `docs/domain/ride-lifecycle.md` §2.3/§2.4; PRD FR-013).
 *
 * Flow (one transaction, Phase 3.7 lifecycle convention):
 *
 *   validate input shape
 *   → LOCK the ride row (SELECT ... FOR UPDATE)
 *   → ride must exist (else NotFoundError)
 *   → actor must be the ride creator (else AuthorizationError)
 *   → ride status must be startable (else BusinessRuleError)
 *   → transitionRideStatus(status, IN_PROGRESS)   [Phase 3.1 state machine]
 *   → update ride → IN_PROGRESS
 *   → write RideStatusHistory (fromStatus, toStatus IN_PROGRESS,
 *     changedByUserId = actor, meaningful reason)
 *   → typed result
 *
 * Notification behavior: the existing Phase 3.8 mapping defines six events
 * and NO draft exists for RIDE_STARTED (`notification-mapping.ts`). Per the
 * canonical Phase 3.17 spec (§9), starting creates NO notification and NO
 * realtime event. Do not invent one.
 *
 * A ride that is not PUBLISHED/CONFIRMED (e.g. still DRAFT, already
 * IN_PROGRESS, or terminal) fails with `BusinessRuleError`.
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
import { canStartRide } from '../domain/lifecycle-rules.js';
import { transitionRideStatus } from '../domain/ride-state-machine.js';
import {
  defaultRideLifecycleDependencies,
  type RideLifecycleDependencies,
} from './ride-lifecycle.js';

/** History reason for a creator start (`ride-lifecycle.md` §2.3/§2.4). */
export const RIDE_STARTED_REASON = 'Ride started by creator';

/** The creator's trusted input for starting. */
export interface StartRideInput {
  rideId: string;
  /** The acting user. Authentication is a later phase; this is trusted input. */
  actorId: string;
}

/** The started ride, shaped for application-layer consumers. */
export interface StartedRide {
  rideId: string;
  status: RideStatus;
  /** The moment the ride was started (the transaction's decision time). */
  startedAt: Date;
}

/** Application-level input shape checks for starting. */
function assertValidStartInput(input: StartRideInput): void {
  if (typeof input.rideId !== 'string' || input.rideId.trim() === '') {
    throw new ValidationError('rideId is required', { field: 'rideId' });
  }
  if (typeof input.actorId !== 'string' || input.actorId.trim() === '') {
    throw new ValidationError('actorId is required', { field: 'actorId' });
  }
}

/**
 * Starts a PUBLISHED or CONFIRMED ride owned by the actor.
 *
 * Throws `ValidationError` (malformed input), `NotFoundError` (missing ride),
 * `AuthorizationError` (actor is not the ride creator), or
 * `BusinessRuleError` (ride status cannot be started — e.g. still DRAFT or
 * already IN_PROGRESS). Starting is therefore idempotent-proof: starting a
 * running ride fails with `BusinessRuleError` rather than writing a duplicate
 * history row.
 */
export async function startRide(
  input: StartRideInput,
  deps: Partial<RideLifecycleDependencies> = {},
): Promise<StartedRide> {
  const { runTransaction, publishEvents } = {
    ...defaultRideLifecycleDependencies(),
    ...deps,
  };

  assertValidStartInput(input);

  const outcome = await runTransaction(async (persistence) => {
    // 1. Lock the ride row — serializes starting with every other lifecycle
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
        'Only the ride creator can start this ride',
        {
          field: 'actorId',
          details: { rideId: ride.id },
        },
      );
    }

    // 3. Startable state — delegating to the state machine
    //    (`docs/domain/ride-lifecycle.md` §2.3/§2.4).
    if (!canStartRide(ride.status)) {
      throw new BusinessRuleError(
        `Ride cannot be started from status ${ride.status}`,
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
        RideStatus.IN_PROGRESS,
      );

      // 5. Atomic writes: ride status + status history. No notification is
      //    created (existing mapping has no RIDE_STARTED draft), so `drafts`
      //    is empty and no realtime event is published.
      await persistence.updateRideStatus({
        rideId: ride.id,
        status: resultingStatus,
      });
      await persistence.createStatusHistory({
        rideId: ride.id,
        fromStatus: ride.status,
        toStatus: resultingStatus,
        changedByUserId: input.actorId,
        reason: RIDE_STARTED_REASON,
      });

      return {
        result: {
          rideId: ride.id,
          status: resultingStatus,
          startedAt: new Date(),
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
      throw new InternalError('Failed to start ride', { cause: err });
    }
  });

  await publishEvents?.(outcome.drafts);
  return outcome.result;
}
