/**
 * Ride expiration use case (Phase 3.7 — EXPIRATION).
 *
 * Marks an eligible `PUBLISHED` ride as `EXPIRED`. Expiration is a separate
 * application operation from cancellation; it evaluates the ride against an
 * explicit `referenceTime` (injected, never `new Date()` inside domain rules)
 * so time-dependent behaviour is deterministic and testable.
 *
 * Eligibility is split from policy (Phase 3.7 §9–§11):
 *
 * - Eligibility logic lives in `domain/expiration-rules.ts` (only `PUBLISHED`
 *   rides whose departure window has passed may expire — `ride-lifecycle.md`
 *   §2.7/§5; `CONFIRMED`/`IN_PROGRESS`/terminal rides never expire).
 * - The grace window is OD-002 (OPEN) and is supplied as explicit input
 *   (`graceWindowMs`, defaulting to `DEFAULT_RIDE_EXPIRATION_GRACE_MS = 0` —
 *   the documented baseline "departure datetime has passed"). No arbitrary
 *   grace period is hardcoded.
 *
 * The operation is idempotent and safe: if the ride is not in an expirable
 * state or the departure window has not passed, it does nothing and returns
 * `statusChanged: false` with NO history row. Running expiration twice never
 * creates duplicate history or throws for an already-expired ride.
 *
 * Flow (all inside one transaction):
 *
 *   validate input shape
 *   → LOCK the ride row (SELECT ... FOR UPDATE) — serializes with every other
 *     decision/lifecycle operation; if a concurrent operation already changed
 *     the ride, the fresh state is read under the lock and expiration no-ops
 *   → ride must exist (else NotFoundError)
 *   → evaluate eligibility (status + departure window) against the locked row
 *   → if not eligible: return unchanged (statusChanged: false)
 *   → transitionRideStatus(PUBLISHED, EXPIRED)   [Phase 3.1 state machine]
 *   → update ride → EXPIRED
 *   → write RideStatusHistory (changedByUserId = null — the system is the
 *     actor, `ride-lifecycle.md` §2.7)
 *   → create notification (Phase 3.8): RIDE_EXPIRED → creator + confirmed
 *     participants
 *   → typed result
 *
 * No HTTP, no scheduled job/cron infrastructure (the reference-time trigger
 * is a future concern; this is the pure operation).
 */
import { RideStatus } from '@prisma/client';
import {
  AppError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import { canExpireRide } from '../domain/expiration-rules.js';
import { transitionRideStatus } from '../domain/ride-state-machine.js';
import {
  defaultRideLifecycleDependencies,
  type RideLifecycleDependencies,
} from './ride-lifecycle.js';
import {
  persistNotificationDrafts,
  rideExpiredDrafts,
  type NotificationDraft,
} from '../../notification/application/notification-mapping.js';

/**
 * History reason for an expiration (`ride-lifecycle.md` §2.7 — the departure
 * datetime passed without the ride being started).
 */
export const RIDE_EXPIRED_REASON = 'Ride expired: departure passed unstarted';

/**
 * The default expiration grace window (milliseconds).
 *
 * OD-002 ("exact cancellation windows / grace periods / expiration grace")
 * is deliberately OPEN — no product value has been approved. The baseline of
 * 0 is exactly `ride-lifecycle.md` §2.7's literal entry condition ("departure
 * datetime has passed") with `grace_window = 0` in §5's candidate rule. This
 * constant is explicit, documented policy input — replace it when OD-002 is
 * decided; it is never hidden inside domain logic.
 */
export const DEFAULT_RIDE_EXPIRATION_GRACE_MS = 0;

/** The input for expiration: an explicit reference time, never wall-clock. */
export interface ExpireRideInput {
  rideId: string;
  /** The time the expiration is evaluated against (deterministic, testable). */
  referenceTime: Date;
  /**
   * Optional expiration grace window in milliseconds (OD-002 policy). Defaults
   * to `DEFAULT_RIDE_EXPIRATION_GRACE_MS` (0) — no grace beyond departure.
   */
  graceWindowMs?: number;
}

/** The result of an expiration evaluation, shaped for application consumers. */
export interface ExpiredRide {
  rideId: string;
  /** The ride status after the operation (EXPIRED when changed). */
  status: RideStatus;
  /** False when the ride was not eligible and was left untouched. */
  statusChanged: boolean;
}

/** Application-level input shape checks for expiration. */
function assertValidExpirationInput(input: ExpireRideInput): void {
  if (typeof input.rideId !== 'string' || input.rideId.trim() === '') {
    throw new ValidationError('rideId is required', { field: 'rideId' });
  }
  if (
    !(input.referenceTime instanceof Date) ||
    Number.isNaN(input.referenceTime.getTime())
  ) {
    throw new ValidationError('referenceTime must be a valid date', {
      field: 'referenceTime',
    });
  }
  if (
    input.graceWindowMs !== undefined &&
    (!Number.isFinite(input.graceWindowMs) || input.graceWindowMs < 0)
  ) {
    throw new ValidationError(
      'graceWindowMs must be a non-negative number of milliseconds',
      {
        field: 'graceWindowMs',
        details: { graceWindowMs: input.graceWindowMs },
      },
    );
  }
}

/**
 * Evaluates a ride against `referenceTime` and expires it when eligible.
 *
 * Idempotent: an already-expired (or otherwise ineligible) ride is returned
 * unchanged with `statusChanged: false` and no history row; a missing ride
 * throws `NotFoundError`; malformed input throws `ValidationError`;
 * unexpected persistence failures are wrapped in `InternalError`.
 */
export async function expireRide(
  input: ExpireRideInput,
  deps: Partial<RideLifecycleDependencies> = {},
): Promise<ExpiredRide> {
  const { runTransaction, publishEvents, publishPush } = {
    ...defaultRideLifecycleDependencies(),
    ...deps,
  };
  const graceWindowMs = input.graceWindowMs ?? DEFAULT_RIDE_EXPIRATION_GRACE_MS;

  assertValidExpirationInput(input);

  const outcome = await runTransaction(async (persistence) => {
    // 1. Lock the ride row. If a concurrent operation (accept/reject/cancel/
    //    another expiration) already changed the ride, the authoritative
    //    status is read here under the lock.
    const ride = await persistence.lockRide(input.rideId);
    if (!ride) {
      throw new NotFoundError('Ride not found', {
        field: 'rideId',
        details: { rideId: input.rideId },
      });
    }

    // 2. Evaluate eligibility against the locked, authoritative state.
    if (
      !canExpireRide({
        status: ride.status,
        departureDateTime: ride.departureDateTime,
        referenceTime: input.referenceTime,
        graceWindowMs,
      })
    ) {
      // Not eligible (already expired, another terminal state, CONFIRMED /
      // IN_PROGRESS, or departure not passed): do nothing safely. No drafts,
      // so no realtime event is published for a no-op expiration.
      return {
        result: {
          rideId: ride.id,
          status: ride.status,
          statusChanged: false,
        },
        drafts: [] as NotificationDraft[],
      };
    }

    try {
      // 3. Produce the resulting state through the Phase 3.1 state machine.
      const resultingStatus = transitionRideStatus(
        ride.status,
        RideStatus.EXPIRED,
      );

      // 4. Atomic writes: ride status + status history. The system is the
      //    actor for expiration, so changedByUserId is null.
      await persistence.updateRideStatus({
        rideId: ride.id,
        status: resultingStatus,
      });
      await persistence.createStatusHistory({
        rideId: ride.id,
        fromStatus: ride.status,
        toStatus: resultingStatus,
        changedByUserId: null,
        reason: RIDE_EXPIRED_REASON,
      });

      // Phase 3.8: RIDE_EXPIRED → creator + confirmed participants, committed
      // atomically with the expiration. Only on the no-op path is nothing
      // written (the early return above); a changed ride always notifies.
      const confirmedParticipantIds =
        await persistence.findConfirmedParticipantIds(ride.id);
      const drafts: NotificationDraft[] = rideExpiredDrafts({
        rideId: ride.id,
        creatorId: ride.creatorId,
        confirmedParticipantIds,
      });
      await persistNotificationDrafts(persistence.createNotification, drafts);

      return {
        result: {
          rideId: ride.id,
          status: resultingStatus,
          statusChanged: true,
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
      throw new InternalError('Failed to expire ride', { cause: err });
    }
  });

  // Phase 3.11: publish AFTER the transaction committed. If the transaction
  // failed/rolled back, this line is never reached — no event is emitted. A
  // no-op expiration (statusChanged false) has no drafts, so nothing is
  // published either.
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
