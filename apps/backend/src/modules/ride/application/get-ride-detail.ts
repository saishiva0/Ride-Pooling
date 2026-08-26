/**
 * Creator ride detail use case (Phase 3.17 — CREATOR RIDE DETAIL).
 *
 * Returns a single ride owned by the actor, with status and live seat
 * availability, for the creator's detail screen (the existing participant
 * detail route is keyed to discovery output; the creator's screen fetches by
 * ride id).
 *
 * Read-only: performs no writes and enforces no lifecycle rules. Creator
 * authorization is enforced here (the actor must own the ride) — the mobile
 * detail screen has no ride data of its own, only a rideId, so the backend
 * is authoritative (never trusts caller-supplied ride identity). "An
 * authenticated creator must be able to see the rides they created" —
 * `docs/planning/phases/phase-3-17.md` §4.4.
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
 * Returns the actor's own ride by id.
 *
 * Throws `ValidationError` (malformed input), `NotFoundError` (missing ride —
 * even when it belongs to someone else, so existence is not leaked), or
 * `AuthorizationError` (the ride exists but the actor is not its creator).
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

  const record = await runTransaction((persistence) =>
    persistence.findCreatorRide(input.rideId),
  );
  if (!record) {
    throw new NotFoundError('Ride not found', {
      field: 'rideId',
      details: { rideId: input.rideId },
    });
  }
  if (record.ride.creator.id !== input.actorId) {
    throw new AuthorizationError('Only the ride creator can view this ride', {
      field: 'actorId',
      details: { rideId: input.rideId },
    });
  }
  return toCreatorRide(record);
}
