/**
 * Ride publishing use case (Phase 3.17 — PUBLISH).
 *
 * The ride creator publishes a DRAFT ride (DRAFT → PUBLISHED), making it
 * discoverable (`docs/domain/ride-lifecycle.md` §2.2; PRD FR-012).
 *
 * Flow (all inside one transaction, following the Phase 3.7 lifecycle
 * convention — see `docs/development/phase-3-7-notes.md`):
 *
 *   validate input shape
 *   → LOCK the ride row (SELECT ... FOR UPDATE) — serializes with every other
 *     decision/lifecycle operation for this ride
 *   → ride must exist (else NotFoundError)
 *   → actor must be the ride creator (else AuthorizationError)
 *   → ride status must be publishable (else BusinessRuleError)
 *   → transitionRideStatus(status, PUBLISHED)   [Phase 3.1 state machine]
 *   → update ride → PUBLISHED
 *   → write RideStatusHistory (fromStatus, toStatus PUBLISHED,
 *     changedByUserId = actor, meaningful reason)
 *   → typed result
 *
 * Notification behavior: the existing Phase 3.8 notification mapping defines
 * six events (RIDE_REQUESTED / REQUEST_ACCEPTED / REQUEST_REJECTED /
 * RIDE_CONFIRMED / RIDE_CANCELLED / RIDE_EXPIRED) and NO draft exists for
 * RIDE_PUBLISHED (`notification-mapping.ts`). Per the canonical Phase 3.17
 * spec (§9 — "creator-visible notifications only where the existing mapping
 * already defines them"), publishing creates NO notification and publishes NO
 * realtime event. Do not invent one here.
 *
 * Repeated publish of an already-published (or otherwise non-DRAFT) ride
 * fails with `BusinessRuleError` rather than writing duplicate history.
 *
 * No HTTP, no authentication (actorId is trusted input,
 * consistent with Phase 3.6/3.7).
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
import { canPublishRide } from '../domain/lifecycle-rules.js';
import { transitionRideStatus } from '../domain/ride-state-machine.js';
import {
  defaultRideLifecycleDependencies,
  type RideLifecycleDependencies,
} from './ride-lifecycle.js';

/** History reason for a creator publication (`ride-lifecycle.md` §2.2). */
export const RIDE_PUBLISHED_REASON = 'Ride published by creator';

/** The creator's trusted input for publishing. */
export interface PublishRideInput {
  rideId: string;
  /** The acting user. Authentication is a later phase; this is trusted input. */
  actorId: string;
}

/** The published ride, shaped for application-layer consumers. */
export interface PublishedRide {
  rideId: string;
  status: RideStatus;
  /** The moment the ride was published (the transaction's decision time). */
  publishedAt: Date;
}

/** Application-level input shape checks for publishing. */
function assertValidPublishInput(input: PublishRideInput): void {
  if (typeof input.rideId !== 'string' || input.rideId.trim() === '') {
    throw new ValidationError('rideId is required', { field: 'rideId' });
  }
  if (typeof input.actorId !== 'string' || input.actorId.trim() === '') {
    throw new ValidationError('actorId is required', { field: 'actorId' });
  }
}

/**
 * Publishes a DRAFT ride owned by the actor.
 *
 * Throws `ValidationError` (malformed input), `NotFoundError` (missing ride),
 * `AuthorizationError` (actor is not the ride creator), or
 * `BusinessRuleError` (ride status cannot be published — e.g. already
 * PUBLISHED or another non-DRAFT state). Repeated publication of an already
 * non-DRAFT ride therefore fails with `BusinessRuleError` rather than writing
 * a duplicate history row.
 */
export async function publishRide(
  input: PublishRideInput,
  deps: Partial<RideLifecycleDependencies> = {},
): Promise<PublishedRide> {
  const { runTransaction, publishEvents } = {
    ...defaultRideLifecycleDependencies(),
    ...deps,
  };

  assertValidPublishInput(input);

  const outcome = await runTransaction(async (persistence) => {
    // 1. Lock the ride row. This serializes publishing with every other
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
        'Only the ride creator can publish this ride',
        {
          field: 'actorId',
          details: { rideId: ride.id },
        },
      );
    }

    // 3. Publishable state — delegating to the state machine
    //    (`docs/domain/ride-lifecycle.md` §2.1).
    if (!canPublishRide(ride.status)) {
      throw new BusinessRuleError(
        `Ride cannot be published from status ${ride.status}`,
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
        RideStatus.PUBLISHED,
      );

      // 5. Atomic writes: ride status + status history. No notification is
      //    created (see the module docstring — the existing mapping has no
      //    RIDE_PUBLISHED draft), so `drafts` is empty and no realtime event
      //    is published.
      await persistence.updateRideStatus({
        rideId: ride.id,
        status: resultingStatus,
      });
      await persistence.createStatusHistory({
        rideId: ride.id,
        fromStatus: ride.status,
        toStatus: resultingStatus,
        changedByUserId: input.actorId,
        reason: RIDE_PUBLISHED_REASON,
      });

      return {
        result: {
          rideId: ride.id,
          status: resultingStatus,
          publishedAt: new Date(),
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
      throw new InternalError('Failed to publish ride', { cause: err });
    }
  });

  // Phase 3.11: publish AFTER the transaction committed. Empty drafts means
  // nothing is emitted for a publication.
  await publishEvents?.(outcome.drafts);
  return outcome.result;
}
