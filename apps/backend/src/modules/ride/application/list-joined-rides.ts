/**
 * Participant "joined rides" use case (V1 rider read path).
 *
 * Returns the rides the authenticated participant is a CONFIRMED participant
 * of (any ride status), ordered by departure time ascending, each with live
 * seat availability and creator information already permitted by the existing
 * contracts. Lets a confirmed participant recover their joined ride — and see
 * it in their ride history — after an app restart.
 *
 * Read-only: performs no writes and enforces no lifecycle rules. Creator
 * authorization is untouched: this is an explicit participant read path, and
 * the ride detail read is separately extended with the same explicit
 * membership rule. No pagination, filtering, or additional history semantics
 * are introduced (OD-013 remains OPEN).
 */
import { ValidationError } from '../../../lib/errors.js';
import {
  defaultParticipantRideReadDependencies,
  type ParticipantRideReadDependencies,
} from './participant-ride-read.js';
import { toCreatorRide, type CreatorRide } from './creator-ride-read.js';

/** The participant's trusted input. */
export interface ListJoinedRidesInput {
  userId: string;
}

/** Application-level input shape checks for the listing. */
function assertValidInput(input: ListJoinedRidesInput): void {
  if (typeof input.userId !== 'string' || input.userId.trim() === '') {
    throw new ValidationError('userId is required', { field: 'userId' });
  }
}

/**
 * Lists the rides the participant is a CONFIRMED participant of, earliest
 * departure first. Returns an empty array when the participant has joined no
 * rides.
 *
 * Throws `ValidationError` for a malformed input.
 */
export async function listJoinedRides(
  input: ListJoinedRidesInput,
  deps: Partial<ParticipantRideReadDependencies> = {},
): Promise<CreatorRide[]> {
  const { runTransaction } = {
    ...defaultParticipantRideReadDependencies(),
    ...deps,
  };

  assertValidInput(input);

  const records = await runTransaction((persistence) =>
    persistence.listConfirmedRides(input.userId),
  );
  return records.map(toCreatorRide);
}
