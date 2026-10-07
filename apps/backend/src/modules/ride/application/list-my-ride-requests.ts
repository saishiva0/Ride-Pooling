/**
 * Participant "My Requests" use case (V1 rider read path).
 *
 * Returns the authenticated participant's own ride requests (any status),
 * oldest first, each with the requested ride (including live seat
 * availability and creator information already permitted by the existing
 * contracts) — the server-authoritative source for the mobile My Requests
 * screen. Replaces the former session-local mobile store as the source of
 * truth; the store may remain a UI cache but is no longer authoritative.
 *
 * Read-only: performs no writes and enforces no lifecycle rules. Identity is
 * the caller's trusted `userId` (derived from authentication at the HTTP
 * boundary, never accepted from the client for authorization). No pagination,
 * filtering, or sorting is introduced beyond the documented oldest-first
 * presentation order.
 */
import { ValidationError } from '../../../lib/errors.js';
import {
  defaultParticipantRideReadDependencies,
  toParticipantRideRequest,
  type ParticipantRideReadDependencies,
  type ParticipantRideRequest,
} from './participant-ride-read.js';

/** The participant's trusted input. */
export interface ListMyRideRequestsInput {
  userId: string;
}

/** Application-level input shape checks for the listing. */
function assertValidInput(input: ListMyRideRequestsInput): void {
  if (typeof input.userId !== 'string' || input.userId.trim() === '') {
    throw new ValidationError('userId is required', { field: 'userId' });
  }
}

/**
 * Lists the participant's own requests, oldest first. Returns an empty array
 * when the participant has made no requests.
 *
 * Throws `ValidationError` for a malformed input.
 */
export async function listMyRideRequests(
  input: ListMyRideRequestsInput,
  deps: Partial<ParticipantRideReadDependencies> = {},
): Promise<ParticipantRideRequest[]> {
  const { runTransaction } = {
    ...defaultParticipantRideReadDependencies(),
    ...deps,
  };

  assertValidInput(input);

  const records = await runTransaction((persistence) =>
    persistence.listParticipantRequests(input.userId),
  );
  return records.map(toParticipantRideRequest);
}
