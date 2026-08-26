/**
 * Ride cancellation use case (Phase 3.7 — CANCELLATION).
 *
 * The ride creator cancels a ride. Cancellation respects the existing Phase
 * 3.1 state machine: the ride may be cancelled only from `DRAFT`/`PUBLISHED`/
 * `CONFIRMED`/`IN_PROGRESS`, and the resulting state is produced by
 * `transitionRideStatus` — never by a bypass.
 *
 * Flow (all inside one transaction, see `docs/development/phase-3-7-notes.md`):
 *
 *   validate input shape
 *   → LOCK the ride row (SELECT ... FOR UPDATE) — serializes with every other
 *     decision/lifecycle operation for this ride
 *   → ride must exist (else NotFoundError)
 *   → actor must be the ride creator (else AuthorizationError)
 *   → ride status must be cancellable (else BusinessRuleError)
 *   → transitionRideStatus(status, CANCELLED)   [Phase 3.1 state machine]
 *   → update ride → CANCELLED
 *   → write RideStatusHistory (fromStatus, toStatus CANCELLED,
 *     changedByUserId = actor, meaningful reason)
 *   → create notification (Phase 3.8): RIDE_CANCELLED → creator + confirmed
 *     participants
 *   → typed result
 *
 * Cancellation does NOT modify RideRequest / RideParticipant / User /
 * Location rows, does not touch `totalSeats`, and introduces no seat-release
 * fields (Phase 3.7 §7). Existing confirmed participants remain historically
 * represented; a cancelled ride is simply no longer discoverable (discovery
 * only considers PUBLISHED/CONFIRMED). Request cancellation and seat release
 * are later phases.
 *
 * No HTTP, no authentication (actorId is trusted input,
 * consistent with Phase 3.6).
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
import { canCancelRide } from '../domain/cancellation-rules.js';
import { transitionRideStatus } from '../domain/ride-state-machine.js';
import {
  defaultRideLifecycleDependencies,
  type RideLifecycleDependencies,
} from './ride-lifecycle.js';
import {
  persistNotificationDrafts,
  rideCancelledDrafts,
  type NotificationDraft,
} from '../../notification/application/notification-mapping.js';

/** History reason for a creator cancellation (`ride-engine.md` §4.10). */
export const RIDE_CANCELLED_REASON = 'Ride cancelled by creator';

/** The creator's trusted input for cancellation. */
export interface CancelRideInput {
  rideId: string;
  /** The acting user. Authentication is a later phase; this is trusted input. */
  actorId: string;
}

/** The cancelled ride, shaped for application-layer consumers. */
export interface CancelledRide {
  rideId: string;
  status: RideStatus;
  /** The moment the ride was cancelled (the transaction's decision time). */
  cancelledAt: Date;
}

/** Application-level input shape checks for cancellation. */
function assertValidCancellationInput(input: CancelRideInput): void {
  if (typeof input.rideId !== 'string' || input.rideId.trim() === '') {
    throw new ValidationError('rideId is required', { field: 'rideId' });
  }
  if (typeof input.actorId !== 'string' || input.actorId.trim() === '') {
    throw new ValidationError('actorId is required', { field: 'actorId' });
  }
}

/**
 * Cancels a ride owned by the actor.
 *
 * Throws `ValidationError` (malformed input), `NotFoundError` (missing ride),
 * `AuthorizationError` (actor is not the ride creator), or
 * `BusinessRuleError` (ride status cannot be cancelled — e.g. already
 * CANCELLED or another terminal state). Repeated cancellation of an already
 * terminal ride therefore fails with `BusinessRuleError` rather than writing
 * a duplicate history row.
 */
export async function cancelRide(
  input: CancelRideInput,
  deps: Partial<RideLifecycleDependencies> = {},
): Promise<CancelledRide> {
  const { runTransaction, publishEvents, publishPush } = {
    ...defaultRideLifecycleDependencies(),
    ...deps,
  };

  assertValidCancellationInput(input);

  const outcome = await runTransaction(async (persistence) => {
    // 1. Lock the ride row. This serializes cancellation with every other
    //    decision/lifecycle operation for the ride.
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
        'Only the ride creator can cancel this ride',
        {
          field: 'actorId',
          details: { rideId: ride.id },
        },
      );
    }

    // 3. Cancellable state — delegating to the state machine
    //    (`docs/domain/ride-lifecycle.md` §2.1–§2.7).
    if (!canCancelRide(ride.status)) {
      throw new BusinessRuleError(
        `Ride cannot be cancelled from status ${ride.status}`,
        {
          field: 'rideId',
          details: { rideId: ride.id, status: ride.status },
        },
      );
    }

    try {
      // 4. Produce the resulting state through the Phase 3.1 state machine —
      //    never a bypass.
      const resultingStatus = transitionRideStatus(
        ride.status,
        RideStatus.CANCELLED,
      );

      // 5. Atomic writes: ride status + status history.
      await persistence.updateRideStatus({
        rideId: ride.id,
        status: resultingStatus,
      });
      await persistence.createStatusHistory({
        rideId: ride.id,
        fromStatus: ride.status,
        toStatus: resultingStatus,
        changedByUserId: input.actorId,
        reason: RIDE_CANCELLED_REASON,
      });

      // Phase 3.8: RIDE_CANCELLED → creator + confirmed participants,
      // committed atomically with the cancellation (Phase 3.8 §9–§10).
      const confirmedParticipantIds =
        await persistence.findConfirmedParticipantIds(ride.id);
      const drafts: NotificationDraft[] = rideCancelledDrafts({
        rideId: ride.id,
        creatorId: ride.creatorId,
        confirmedParticipantIds,
      });
      await persistNotificationDrafts(persistence.createNotification, drafts);

      return {
        result: {
          rideId: ride.id,
          status: resultingStatus,
          cancelledAt: new Date(),
        },
        drafts,
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
      throw new InternalError('Failed to cancel ride', { cause: err });
    }
  });

  // Phase 3.11: publish AFTER the transaction committed. If the transaction
  // failed/rolled back, this line is never reached — no event is emitted.
  await publishEvents?.(outcome.drafts);

  // Phase 3.23: push notifications (best-effort, after realtime). Never lets
  // a push failure surface as an operation failure — the ride/request state
  // change already committed.
  try {
    await publishPush?.(outcome.drafts);
  } catch (err) {
    console.error('Push dispatch failed (best-effort, ignored)', err);
  }

  return outcome.result;
}
