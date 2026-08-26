/**
 * Ride request / participation cancellation use case (Phase 3.21 — REQUEST &
 * PARTICIPANT LIFECYCLE COMPLETION).
 *
 * A single endpoint semantics per `docs/architecture/api-boundaries.md`
 * (Requests group: "…accept, reject, **cancel**") that branches on the
 * authoritative request state, mirroring `docs/domain/ride-lifecycle.md` §4.2:
 *
 *   - `PENDING` request  → the participant WITHDRAWS the request. The request
 *     → CANCELLED; the ride state is unchanged (no seat was allocated).
 *   - `ACCEPTED` request → the participant CANCELS their participation: the
 *     participant → CANCELLED (seat freed), the request → CANCELLED, and when
 *     the LAST confirmed participant cancels, the ride reverts
 *     `CONFIRMED → PUBLISHED` (via the Phase 3.1 state machine + history).
 *   - Ride `IN_PROGRESS` → participation cancellation is NOT permitted
 *     (OD-011; `ride-lifecycle.md` §4.2) — BusinessRuleError.
 *   - `REJECTED` / `CANCELLED` request → already resolved — ConflictError.
 *
 * Only the request's OWNER (the requester/participant) may cancel it — never
 * the ride creator (the creator uses accept/reject). No monetary penalties,
 * no time windows (OD-002 stays OPEN — purely state-based, see
 * `docs/development/phase-3-21-notes.md`).
 *
 * Flow (all inside one transaction):
 *
 *   validate input shape
 *   → load request (not found → NotFoundError)
 *   → LOCK the ride row (SELECT ... FOR UPDATE) — serializes with every other
 *     decision/lifecycle operation for this ride
 *   → re-read the request (authoritative status under the lock)
 *   → actor must be the request owner (else AuthorizationError)
 *   → branch on request status (PENDING → withdraw / ACCEPTED → cancel
 *     participation / else ConflictError)
 *   → write request (→ CANCELLED) and, for ACCEPTED, participant (→ CANCELLED,
 *     seat freed) + optional CONFIRMED → PUBLISHED revert + history
 *   → create notification (Phase 3.8): REQUEST_CANCELLED → the ride creator
 *   → typed result
 *
 * No HTTP, no authentication (actorId is trusted input).
 */
import {
  ParticipantStatus,
  RideRequestStatus,
  RideStatus,
} from '@prisma/client';
import {
  AppError,
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  InternalError,
  NotFoundError,
} from '../../../lib/errors.js';
import {
  isCancellableParticipation,
  isWithdrawableRequest,
  shouldRevertToPublished,
} from '../domain/request-cancellation-rules.js';
import { transitionRideStatus } from '../domain/ride-state-machine.js';
import {
  assertValidCancellationInput,
  defaultRideRequestCancellationDependencies,
  type RideRequestCancellationDependencies,
  type RideRequestCancellationInput,
} from './ride-request-cancellation.js';
import {
  persistNotificationDrafts,
  requestCancelledDrafts,
  type NotificationDraft,
} from '../../notification/application/notification-mapping.js';

export type { RideRequestCancellationInput } from './ride-request-cancellation.js';

/** History reason for the last-participant CONFIRMED → PUBLISHED revert. */
export const LAST_PARTICIPANT_CANCELLED_REASON =
  'Last confirmed participant cancelled';

/**
 * The cancelled request / participation, shaped for application-layer
 * consumers. `participantId`/`participantStatus`/`releasedSeats` are non-null
 * only when an ACCEPTED participation was cancelled; `rideStatusChanged` is
 * true only when the ride reverted CONFIRMED → PUBLISHED.
 */
export interface CancelledRideRequest {
  requestId: string;
  requestStatus: RideRequestStatus;
  rideId: string;
  /** The cancelled participant (ACCEPTED path) or null (PENDING withdrawal). */
  participantId: string | null;
  participantStatus: ParticipantStatus | null;
  /** Seats freed by the cancellation (0 for a PENDING withdrawal). */
  releasedSeats: number;
  /** The ride status after cancellation (may have reverted to PUBLISHED). */
  rideStatus: RideStatus;
  rideStatusChanged: boolean;
  cancelledAt: Date;
}

/**
 * Cancels a request owned by the actor: either a PENDING withdrawal or an
 * ACCEPTED participation cancellation.
 *
 * Throws `ValidationError` (malformed input), `NotFoundError` (missing
 * request/ride), `AuthorizationError` (actor is not the request owner),
 * `BusinessRuleError` (ride IN_PROGRESS — OD-011), or `ConflictError`
 * (request already resolved / participation missing or already cancelled).
 */
export async function cancelRideRequest(
  input: RideRequestCancellationInput,
  deps: Partial<RideRequestCancellationDependencies> = {},
): Promise<CancelledRideRequest> {
  const { runTransaction, publishEvents, publishPush } = {
    ...defaultRideRequestCancellationDependencies(),
    ...deps,
  };

  assertValidCancellationInput(input);

  const outcome = await runTransaction(async (persistence) => {
    // 1. Load the request to discover which ride must be locked.
    const request = await persistence.findRequest(input.requestId);
    if (!request) {
      throw new NotFoundError('Ride request not found', {
        field: 'requestId',
        details: { requestId: input.requestId },
      });
    }

    // 2. Lock the ride row. This serializes cancellation with every other
    //    decision/lifecycle operation for the ride.
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

    // 4. Actor rules: only the request's OWNER (the requester/participant)
    //    may cancel it. The creator uses accept/reject instead
    //    (`docs/domain/ride-lifecycle.md` §4.2).
    if (current.userId !== input.actorId) {
      throw new AuthorizationError(
        'Only the requester can cancel their own ride request',
        {
          field: 'actorId',
          details: { rideId: ride.id, requestId: input.requestId },
        },
      );
    }

    // 5. Branch on the authoritative request status (§4.2 / §6).
    if (isWithdrawableRequest(current.status)) {
      // PENDING → withdraw: request → CANCELLED; the ride is untouched (no
      // seat was ever allocated for a PENDING request).
      try {
        const cancelledAt = new Date();
        await persistence.updateRequestStatus({
          requestId: current.id,
          status: RideRequestStatus.CANCELLED,
          resolvedAt: cancelledAt,
        });

        // Phase 3.8: REQUEST_CANCELLED → the ride creator (the participant
        // knows what they did), committed atomically with the withdrawal.
        const drafts: NotificationDraft[] = requestCancelledDrafts({
          rideId: ride.id,
          requestId: current.id,
          creatorId: ride.creatorId,
        });
        await persistNotificationDrafts(persistence.createNotification, drafts);

        return {
          result: {
            requestId: current.id,
            requestStatus: RideRequestStatus.CANCELLED,
            rideId: ride.id,
            participantId: null,
            participantStatus: null,
            releasedSeats: 0,
            rideStatus: ride.status,
            rideStatusChanged: false,
            cancelledAt,
          },
          drafts,
        };
      } catch (err) {
        if (err instanceof AppError) {
          throw err;
        }
        const kind = persistence.classifyError(err);
        if (kind === 'not_found' || kind === 'foreign_key') {
          throw new NotFoundError('Ride request not found', {
            field: 'requestId',
            details: { requestId: current.id },
          });
        }
        throw new InternalError('Failed to withdraw ride request', {
          cause: err,
        });
      }
    }

    // An ACCEPTED participation may not be cancelled while the ride is
    // underway — the one prohibited case (OD-011, §4.2) is reported as a
    // distinct business-rule violation before the participation-cancel guard.
    if (
      current.status === RideRequestStatus.ACCEPTED &&
      ride.status === RideStatus.IN_PROGRESS
    ) {
      throw new BusinessRuleError(
        'Participation cannot be cancelled while the ride is in progress',
        {
          field: 'rideId',
          details: { rideId: ride.id, status: ride.status },
        },
      );
    }

    if (
      isCancellableParticipation({
        requestStatus: current.status,
        rideStatus: ride.status,
      })
    ) {
      // ACCEPTED → cancel participation.

      // The participant row must exist and still be confirmed.
      const participant = await persistence.findParticipantForCancellation(
        current.id,
      );
      if (!participant) {
        throw new ConflictError('No participation exists for this request', {
          field: 'requestId',
          details: { requestId: current.id },
        });
      }
      if (participant.status !== ParticipantStatus.CONFIRMED) {
        throw new ConflictError('Participation is already cancelled', {
          field: 'requestId',
          details: { requestId: current.id, participantId: participant.id },
        });
      }

      try {
        const cancelledAt = new Date();

        // Atomic writes: free the seat (participant → CANCELLED), resolve the
        // request, and — when the LAST confirmed participant cancels — revert
        // the ride CONFIRMED → PUBLISHED via the Phase 3.1 state machine.
        await persistence.updateParticipantStatus({
          id: participant.id,
          cancelledAt,
        });
        await persistence.updateRequestStatus({
          requestId: current.id,
          status: RideRequestStatus.CANCELLED,
          resolvedAt: cancelledAt,
        });

        let resultingRideStatus: RideStatus = ride.status;
        let rideStatusChanged = false;
        if (ride.status === RideStatus.CONFIRMED) {
          const remainingConfirmedSeats = await persistence.countConfirmedSeats(
            ride.id,
          );
          if (
            shouldRevertToPublished({
              rideStatus: ride.status,
              remainingConfirmedSeats,
            })
          ) {
            resultingRideStatus = transitionRideStatus(
              RideStatus.CONFIRMED,
              RideStatus.PUBLISHED,
            );
            await persistence.updateRideStatus({
              rideId: ride.id,
              status: resultingRideStatus,
            });
            await persistence.createStatusHistory({
              rideId: ride.id,
              fromStatus: RideStatus.CONFIRMED,
              toStatus: RideStatus.PUBLISHED,
              changedByUserId: input.actorId,
              reason: LAST_PARTICIPANT_CANCELLED_REASON,
            });
            rideStatusChanged = true;
          }
        }

        // Phase 3.8: REQUEST_CANCELLED → the ride creator, committed atomically
        // with the cancellation.
        const drafts: NotificationDraft[] = requestCancelledDrafts({
          rideId: ride.id,
          requestId: current.id,
          creatorId: ride.creatorId,
        });
        await persistNotificationDrafts(persistence.createNotification, drafts);

        return {
          result: {
            requestId: current.id,
            requestStatus: RideRequestStatus.CANCELLED,
            rideId: ride.id,
            participantId: participant.id,
            participantStatus: ParticipantStatus.CANCELLED,
            releasedSeats: participant.seatsAllocated,
            rideStatus: resultingRideStatus,
            rideStatusChanged,
            cancelledAt,
          },
          drafts,
        };
      } catch (err) {
        if (err instanceof AppError) {
          throw err;
        }
        const kind = persistence.classifyError(err);
        if (kind === 'not_found') {
          throw new NotFoundError('Ride request or participation not found', {
            field: 'requestId',
            details: { requestId: current.id },
          });
        }
        if (kind === 'foreign_key') {
          throw new NotFoundError('Ride or request not found', {
            field: 'rideId',
            details: { rideId: ride.id },
          });
        }
        throw new InternalError('Failed to cancel ride participation', {
          cause: err,
        });
      }
    }

    // REJECTED / CANCELLED requests are historical and cannot be cancelled.
    throw new ConflictError(
      'Only PENDING or ACCEPTED requests can be cancelled',
      {
        field: 'requestId',
        details: { requestId: current.id, status: current.status },
      },
    );
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
