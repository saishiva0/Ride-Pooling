/**
 * Creator ride detail use case (Phase 3.17 — CREATOR RIDE DETAIL).
 *
 * Returns a single ride readable by the actor, with status and live seat
 * availability. The creator's detail screen fetches by ride id; the same
 * read now also serves a CONFIRMED participant reopening a joined ride after
 * restart (V1 rider read path).
 *
 * Read-only: performs no writes and enforces no lifecycle rules. Authorization
 * is the explicit rule "actor is the creator OR a CONFIRMED participant"
 * (creator authorization is not weakened; participation is ORed in). The
 * mobile detail screen has no ride data of its own, only a rideId, so the
 * backend is authoritative (never trusts caller-supplied ride identity). "An
 * authenticated creator must be able to see the rides they created" —
 * `docs/planning/phases/phase-3-17.md` §4.4; "confirmed participants see the
 * ride" — `docs/planning/v1-definition-of-done.md` §1.14.
 */
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import {
  defaultCreatorRideReadDependencies,
  toCreatorRide,
  type CreatorRide,
  type RideCreatorReadDependencies,
} from './creator-ride-read.js';

/** The creator's trusted input. */
export interface GetCreatorRideInput {
  rideId: string;
  actorId: string;
}

/** Application-level input shape checks for the detail lookup. */
function assertValidGetInput(input: GetCreatorRideInput): void {
  if (typeof input.rideId !== 'string' || input.rideId.trim() === '') {
    throw new ValidationError('rideId is required', { field: 'rideId' });
  }
  if (typeof input.actorId !== 'string' || input.actorId.trim() === '') {
    throw new ValidationError('actorId is required', { field: 'actorId' });
  }
}

/**
 * Returns a ride the actor is authorized to read: the ride they created, or a
 * ride they are a CONFIRMED participant of. Both checks run inside one
 * transaction; the participation rule is only consulted when the actor is not
 * the creator.
 *
 * Throws `ValidationError` (malformed input), `NotFoundError` (missing ride —
 * even when it belongs to someone else, so existence is not leaked), or
 * `AuthorizationError` (the ride exists but the actor is neither its creator
 * nor a confirmed participant).
 */
export async function getCreatorRide(
  input: GetCreatorRideInput,
  deps: Partial<RideCreatorReadDependencies> = {},
): Promise<CreatorRide> {
  const { runTransaction } = {
    ...defaultCreatorRideReadDependencies(),
    ...deps,
  };

  assertValidGetInput(input);

  const outcome = await runTransaction(async (persistence) => {
    const ride = await persistence.findCreatorRide(input.rideId);
    if (!ride) {
      return { found: false as const };
    }
    if (ride.ride.creator.id === input.actorId) {
      return { found: true as const, authorized: true, ride };
    }
    const isParticipant = await persistence.hasConfirmedParticipation(
      input.rideId,
      input.actorId,
    );
    return { found: true as const, authorized: isParticipant, ride };
  });

  if (!outcome.found) {
    throw new NotFoundError('Ride not found', {
      field: 'rideId',
      details: { rideId: input.rideId },
    });
  }
  if (!outcome.authorized) {
    throw new AuthorizationError(
      'Only the ride creator or a confirmed participant can view this ride',
      {
        field: 'actorId',
        details: { rideId: input.rideId },
      },
    );
  }
  return toCreatorRide(outcome.ride);
}
