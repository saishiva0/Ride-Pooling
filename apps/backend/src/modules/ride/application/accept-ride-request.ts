/**
 * Ride request acceptance use case (Phase 3.6 — REQUEST ACCEPTANCE).
 *
 * The ride creator accepts a PENDING RideRequest. This is the transactional
 * heart of seat management: it atomically validates the current state,
 * allocates seats by creating a RideParticipant, moves the request to
 * ACCEPTED, and — when the first request is accepted — transitions the ride
 * PUBLISHED → CONFIRMED (via the Phase 3.1 state machine) and records
 * `RideStatusHistory`.
 *
 * Flow (all inside one transaction, see `docs/development/phase-3-6-notes.md`):
 *
 *   validate input shape
 *   → load request (not found → NotFoundError)
 *   → LOCK the ride row (SELECT ... FOR UPDATE) — serializes every decision
 *     for this ride; concurrent accepts/rejects wait, then re-read fresh state
 *   → re-read the request (authoritative status under the lock)
 *   → actor rules (requester ≠ actor; actor == ride creator)
 *   → request must be PENDING (else ConflictError)
 *   → ride status must accept requests (PUBLISHED/CONFIRMED, else
 *     BusinessRuleError)
 *   → confirmed seats are summed and capacity validated (insufficient →
 *     BusinessRuleError)
 *   → no existing participant for the request (else ConflictError)
 *   → create RideParticipant (status CONFIRMED)
 *   → update request → ACCEPTED (resolvedAt set)
 *   → if ride was PUBLISHED: transitionRideStatus(PUBLISHED, CONFIRMED),
 *     update ride, write RideStatusHistory — all in the same transaction
 *   → create notifications (Phase 3.8): REQUEST_ACCEPTED → requester, and on
 *     the first accept RIDE_CONFIRMED → creator + confirmed requester
 *   → typed result
 *
 * Matching/discovery are NOT consulted: the database is authoritative.
 * No HTTP, no authentication (actorId is trusted input).
 */
import { RideRequestStatus, RideStatus } from '@prisma/client';
import {
  AppError,
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  InternalError,
  NotFoundError,
} from '../../../lib/errors.js';
import { transitionRideStatus } from '../domain/ride-state-machine.js';
import {
  hasAvailableSeats,
  INITIAL_PARTICIPANT_STATUS,
  isAcceptableRideStatus,
  isPendingRequest,
} from '../domain/decision-rules.js';
import {
  assertValidDecisionInput,
  defaultRideRequestDecisionDependencies,
  type RideRequestDecisionDependencies,
  type RideRequestDecisionInput,
} from './ride-request-decision.js';
import {
  persistNotificationDrafts,
  requestAcceptedDrafts,
  rideConfirmedDrafts,
  type NotificationDraft,
} from '../../notification/application/notification-mapping.js';

export type { RideRequestDecisionInput } from './ride-request-decision.js';

/** History reason for the first-accept ride transition (Phase 3.2 convention). */
export const FIRST_ACCEPTED_REASON = 'First request accepted';

/**
 * The accepted request, shaped for application-layer consumers. Never exposes
 * raw Prisma records.
 */
export interface AcceptedRideRequest {
  requestId: string;
  requestStatus: RideRequestStatus;
  participantId: string;
  participantStatus: typeof INITIAL_PARTICIPANT_STATUS;
  rideId: string;
  allocatedSeats: number;
  /** The ride status after acceptance (may have transitioned to CONFIRMED). */
  rideStatus: RideStatus;
  /** True only when this acceptance moved the ride PUBLISHED → CONFIRMED. */
  rideStatusChanged: boolean;
}

/**
 * Accepts a PENDING request for a ride the actor owns.
 *
 * Throws `ValidationError` (malformed input), `NotFoundError` (missing
 * request/ride), `AuthorizationError` (actor is not the ride creator),
 * `BusinessRuleError` (requester is the actor / ride not accepting requests /
 * insufficient seats), or `ConflictError` (request not PENDING / participant
 * already exists / unique-constraint race).
 */
export async function acceptRideRequest(
  input: RideRequestDecisionInput,
  deps: Partial<RideRequestDecisionDependencies> = {},
): Promise<AcceptedRideRequest> {
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

    // 2. Lock the ride row. This serializes all decisions for the ride, so
    //    concurrent accepts/rejects wait here and then re-read fresh state.
    const ride = await persistence.lockRideForDecision(request.rideId);
    if (!ride) {
      throw new NotFoundError('Ride not found', {
        field: 'rideId',
        details: { rideId: request.rideId },
      });
    }

    // 3. Re-read the request under the lock — this is the authoritative state.
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
        'A requester cannot accept their own request',
        {
          field: 'actorId',
          details: { requestId: input.requestId },
        },
      );
    }
    if (ride.creatorId !== input.actorId) {
      throw new AuthorizationError(
        'Only the ride creator can accept requests for this ride',
        {
          field: 'actorId',
          details: { rideId: ride.id, requestId: input.requestId },
        },
      );
    }

    // 5. Request must be pending (`docs/domain/ride-lifecycle.md` §6).
    if (!isPendingRequest(current.status)) {
      throw new ConflictError('Only PENDING requests can be accepted', {
        field: 'requestId',
        details: { requestId: input.requestId, status: current.status },
      });
    }

    // 6. Ride status must permit acceptance (PUBLISHED/CONFIRMED).
    if (!isAcceptableRideStatus(ride.status)) {
      throw new BusinessRuleError(
        `Ride is not accepting requests in status ${ride.status}`,
        {
          field: 'rideId',
          details: { rideId: ride.id, status: ride.status },
        },
      );
    }

    // 7. Seat capacity — rechecked here; matching results are advisory.
    const confirmedSeats = await persistence.countConfirmedSeats(ride.id);
    if (
      !hasAvailableSeats(
        current.requestedSeats,
        confirmedSeats,
        ride.totalSeats,
      )
    ) {
      throw new BusinessRuleError(
        'Requested seats exceed the currently available seats',
        {
          field: 'requestId',
          details: {
            requestId: input.requestId,
            requestedSeats: current.requestedSeats,
            availableSeats: ride.totalSeats - confirmedSeats,
            totalSeats: ride.totalSeats,
          },
        },
      );
    }

    // 8. Defense-in-depth: no participant may already exist for this request
    //    (the requestId unique index is the final arbiter of races).
    const existingParticipant = await persistence.findParticipantByRequest(
      current.id,
    );
    if (existingParticipant) {
      throw new ConflictError('A participant already exists for this request', {
        field: 'requestId',
        details: { requestId: current.id },
      });
    }

    try {
      // 9. Atomic writes: participant + request status (+ ride/history).
      const participant = await persistence.createParticipant({
        rideId: ride.id,
        userId: current.userId,
        requestId: current.id,
        seatsAllocated: current.requestedSeats,
        status: INITIAL_PARTICIPANT_STATUS,
      });

      await persistence.updateRequestStatus({
        requestId: current.id,
        status: RideRequestStatus.ACCEPTED,
        resolvedAt: new Date(),
      });

      let resultingRideStatus = ride.status;
      let rideStatusChanged = false;
      if (ride.status === RideStatus.PUBLISHED) {
        // First accepted request: PUBLISHED → CONFIRMED
        // (`docs/domain/ride-lifecycle.md` §2.2 → §2.3), via the Phase 3.1
        // state machine — never duplicated here.
        resultingRideStatus = transitionRideStatus(
          RideStatus.PUBLISHED,
          RideStatus.CONFIRMED,
        );
        await persistence.updateRideStatus({
          rideId: ride.id,
          status: resultingRideStatus,
        });
        await persistence.createStatusHistory({
          rideId: ride.id,
          fromStatus: RideStatus.PUBLISHED,
          toStatus: RideStatus.CONFIRMED,
          changedByUserId: input.actorId,
          reason: FIRST_ACCEPTED_REASON,
        });
        rideStatusChanged = true;
      }

      // Phase 3.8: notifications committed atomically with the acceptance.
      // REQUEST_ACCEPTED → the requester; on the first accept (PUBLISHED →
      // CONFIRMED) also RIDE_CONFIRMED → creator + the confirmed requester.
      const drafts: NotificationDraft[] = [
        ...requestAcceptedDrafts({
          rideId: ride.id,
          requestId: current.id,
          requesterId: current.userId,
        }),
      ];
      if (rideStatusChanged) {
        drafts.push(
          ...rideConfirmedDrafts({
            rideId: ride.id,
            creatorId: ride.creatorId,
            confirmedParticipantIds: [current.userId],
          }),
        );
      }
      await persistNotificationDrafts(persistence.createNotification, drafts);

      return {
        result: {
          requestId: current.id,
          requestStatus: RideRequestStatus.ACCEPTED,
          participantId: participant.id,
          participantStatus: participant.status,
          rideId: ride.id,
          allocatedSeats: participant.seatsAllocated,
          rideStatus: resultingRideStatus,
          rideStatusChanged,
        },
        drafts,
      };
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      const kind = persistence.classifyError(err);
      if (kind === 'unique') {
        // Concurrent duplicate participant (requestId or confirmed (ride,user)
        // unique index) — the losing operation never double-allocates seats.
        throw new ConflictError(
          'A participant already exists for this request',
          {
            field: 'requestId',
            details: { requestId: current.id },
          },
        );
      }
      if (kind === 'foreign_key') {
        throw new NotFoundError('Ride or request not found', {
          field: 'rideId',
          details: { rideId: ride.id },
        });
      }
      throw new InternalError('Failed to accept ride request', { cause: err });
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
