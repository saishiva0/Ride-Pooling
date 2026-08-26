/**
 * Creator ride listing use case (Phase 3.17 — MY RIDES).
 *
 * Returns the authenticated creator's own rides with status and live seat
 * availability, ordered by `departureDateTime` ascending (earliest departure
 * first) — the canonical presentation order for the creator's ride list
 * (`docs/planning/phases/phase-3-17.md` §4.3). No pagination or filters in
 * this phase (canonical scope).
 *
 * Read-only: performs no writes and enforces no lifecycle rules — the status
 * values are carried through verbatim so the mobile client can partition
 * them (My Rides / Active Ride / History). Authentication (actorId) is a
 * later phase; the id is trusted input, consistent with Phase 3.6/3.7.
 */
import { ValidationError } from '../../../lib/errors.js';
import {
  defaultCreatorRideReadDependencies,
  toCreatorRide,
  type CreatorRide,
  type RideCreatorReadDependencies,
} from './creator-ride-read.js';

/** The creator's trusted input. */
export interface ListCreatorRidesInput {
  actorId: string;
}

/** Application-level input shape checks for listing. */
function assertValidListInput(input: ListCreatorRidesInput): void {
  if (typeof input.actorId !== 'string' || input.actorId.trim() === '') {
    throw new ValidationError('actorId is required', { field: 'actorId' });
  }
}

/**
 * Lists the actor's own rides (any status), ordered by departure time
 * ascending. Returns an empty array when the creator has no rides.
 *
 * Throws `ValidationError` for a malformed input.
 */
export async function listCreatorRides(
  input: ListCreatorRidesInput,
  deps: Partial<RideCreatorReadDependencies> = {},
): Promise<CreatorRide[]> {
  const { runTransaction } = {
    ...defaultCreatorRideReadDependencies(),
    ...deps,
  };

  assertValidListInput(input);

  const records = await runTransaction((persistence) =>
    persistence.listCreatorRides(input.actorId),
  );
  return records.map(toCreatorRide);
}
