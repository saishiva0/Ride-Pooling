/**
 * Ride request rejection use case (Phase 3.6 — REQUEST REJECTION).
 *
 * The ride creator rejects a PENDING RideRequest. Rejection is deliberately
 * minimal: no participant is created, no seat is allocated, and no ride state
 * or history is touched. The request simply moves PENDING → REJECTED with
 * `resolvedAt` set.
 *
 * Flow (all inside one transaction):
 *
 *   validate input shape
 *   → load request (not found → NotFoundError)
 *   → LOCK the ride row (SELECT ... FOR UPDATE) — same deterministic order as
 *     acceptance, so a concurrent accept+reject of the same request serialize
 *     and exactly one terminal outcome wins
 *   → re-read the request (authoritative status under the lock)
 *   → actor rules (requester ≠ actor; actor == ride creator)
 *   → request must be PENDING (else ConflictError)
 *   → update request → REJECTED (resolvedAt set)
 *   → create notification (Phase 3.8): REQUEST_REJECTED → requester
 *   → typed result
 *
 * No HTTP, no authentication (actorId is trusted input).
 */
import { RideRequestStatus } from '@prisma/client';
import {
  AppError,
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  InternalError,
  NotFoundError,
} from '../../../lib/errors.js';
import { isPendingRequest } from '../domain/decision-rules.js';
import {
  assertValidDecisionInput,
  defaultRideRequestDecisionDependencies,
  type RideRequestDecisionDependencies,
  type RideRequestDecisionInput,
} from './ride-request-decision.js';
import {
  persistNotificationDrafts,
  requestRejectedDrafts,
  type NotificationDraft,
} from '../../notification/application/notification-mapping.js';

export type { RideRequestDecisionInput } from './ride-request-decision.js';

/** The rejected request, shaped for application-layer consumers. */
export interface RejectedRideRequest {
  requestId: string;
  requestStatus: RideRequestStatus;
  rideId: string;
}

/**
 * Rejects a PENDING request for a ride the actor owns.
 *
 * Throws `ValidationError` (malformed input), `NotFoundError` (missing
 * request/ride), `AuthorizationError` (actor is not the ride creator),
 * `BusinessRuleError` (requester is the actor), or `ConflictError` (request
 * not PENDING).
 */
export async function rejectRideRequest(
  input: RideRequestDecisionInput,
  deps: Partial<RideRequestDecisionDependencies> = {},
): Promise<RejectedRideRequest> {
  const { runTransaction, publishEvents, publishPush } = {
    ...defaultRideRequestDecisionDependencies(),
    ...deps,
  };

  assertValidDecisionInput(input);

  const outcome = await runTransaction(async (persistence) => {
    // 1. Load the request to discover which ride must be locked.
    const request = await persistence.findRequest(input.requestId);
    if (!request) {
      throw new NotFoundError('Ride request not found', {
        field: 'requestId',
        details: { requestId: input.requestId },
      });
    }

    // 2. Lock the ride row in the same order acceptance does, so an accept and
    //    a reject of the same request cannot interleave.
    const ride = await persistence.lockRideForDecision(request.rideId);
    if (!ride) {
      throw new NotFoundError('Ride not found', {
        field: 'rideId',
        details: { rideId: request.rideId },
      });
    }

    // 3. Re-read the request under the lock — the authoritative state.
    const current = await persistence.findRequest(input.requestId);
    if (!current || current.rideId !== ride.id) {
      throw new NotFoundError('Ride request not found', {
        field: 'requestId',
        details: { requestId: input.requestId },
      });
    }

    // 4. Actor rules (business-level authorization; auth is a later phase).
    if (current.userId === input.actorId) {
      throw new BusinessRuleError(
        'A requester cannot reject their own request',
        {
          field: 'actorId',
          details: { requestId: input.requestId },
        },
      );
    }
    if (ride.creatorId !== input.actorId) {
      throw new AuthorizationError(
        'Only the ride creator can reject requests for this ride',
        {
          field: 'rideId',
          details: { rideId: ride.id, requestId: input.requestId },
        },
      );
    }

    // 5. Request must be pending (`docs/domain/ride-lifecycle.md` §6).
    if (!isPendingRequest(current.status)) {
      throw new ConflictError('Only PENDING requests can be rejected', {
        field: 'requestId',
        details: { requestId: input.requestId, status: current.status },
      });
    }

    try {
      // 6. Single atomic write: PENDING → REJECTED. No participant, no seat
      //    allocation, no ride state/history changes.
      const updated = await persistence.updateRequestStatus({
        requestId: current.id,
        status: RideRequestStatus.REJECTED,
        resolvedAt: new Date(),
      });

      // Phase 3.8: REQUEST_REJECTED → the requester, committed atomically
      // with the rejection (Phase 3.8 §9–§10).
      const drafts: NotificationDraft[] = requestRejectedDrafts({
        rideId: ride.id,
        requestId: updated.id,
        requesterId: updated.userId,
      });
      await persistNotificationDrafts(persistence.createNotification, drafts);

      return {
        result: {
          requestId: updated.id,
          requestStatus: updated.status,
          rideId: updated.rideId,
        },
        drafts,
      };
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      const kind = persistence.classifyError(err);
      if (kind === 'foreign_key') {
        throw new NotFoundError('Ride request not found', {
          field: 'requestId',
          details: { requestId: input.requestId },
        });
      }
      throw new InternalError('Failed to reject ride request', { cause: err });
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
