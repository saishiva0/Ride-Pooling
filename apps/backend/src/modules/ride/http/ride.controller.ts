/**
 * Ride HTTP controllers (Phase 3.10).
 *
 * Thin by construction: read the request, read the authenticated identity,
 * parse HTTP input with Zod, call ONE existing application service, and
 * envelope the result. No Prisma, no repositories, no business rules, no
 * seat/pricing/matching logic, no state transitions, no raw ids from the
 * body — the actor id always comes from the authentication boundary
 * (`getAuthenticatedUser`) and is passed through as the service's trusted
 * input. Errors are thrown and handled centrally.
 */
import type { Request, Response } from 'express';
import { getAuthenticatedUser } from '../../auth/http/auth.middleware.js';
import { parseRequest } from '../../api/parse.js';
import { sendData } from '../../api/response.js';
import { createRide } from '../application/create-ride.js';
import { discoverRides } from '../application/discover-rides.js';
import { matchRides } from '../application/match-rides.js';
import type { MatchingConfiguration } from '../domain/matching/types.js';
import { createRideRequest } from '../application/create-ride-request.js';
import { acceptRideRequest } from '../application/accept-ride-request.js';
import { rejectRideRequest } from '../application/reject-ride-request.js';
import { cancelRideRequest } from '../application/cancel-ride-request.js';
import { cancelRide } from '../application/cancel-ride.js';
import { completeRide } from '../application/complete-ride.js';
import { getCreatorRide } from '../application/get-ride-detail.js';
import { listCreatorRides } from '../application/list-creator-rides.js';
import { publishRide } from '../application/publish-ride.js';
import { startRide } from '../application/start-ride.js';
import {
  createRideRequestSchema,
  createRideSchema,
  discoverRidesQuerySchema,
  matchRidesSchema,
  requestDecisionPathSchema,
  rideIdPathSchema,
} from './ride.schemas.js';

/** POST /api/v1/rides — the authenticated user is the creator. */
export async function createRideHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const body = parseRequest(createRideSchema, req.body);

  const ride = await createRide({
    creatorId: identity.userId,
    ...body,
  });
  sendData(res, 201, ride);
}

/** GET /api/v1/rides/discover — candidate retrieval around a pickup point. */
export async function discoverRidesHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const query = parseRequest(discoverRidesQuerySchema, req.query);

  // Phase 3.24 (Reporting & Blocking, §13 — DECIDED): the viewer's own id is
  // passed through so an active block excludes the blocked pair from each
  // other's discovery results, going forward.
  const rides = await discoverRides({ ...query, viewerId: identity.userId });
  sendData(res, 200, rides);
}

/**
 * POST /api/v1/rides/match — discovery then deterministic matching.
 *
 * Matching thresholds and the result cap are server-controlled product policy
 * (OD-004 — resolved Phase 3.19); they are injected from the application
 * config and callers can never supply them. Discovery uses the pickup point
 * from the request with the server's pickup radius and the server's result
 * cap as the candidate-retrieval limit.
 */
export interface MatchRidesHandlerDependencies {
  matchingConfig: MatchingConfiguration;
  matchingMaxResults: number;
}

export function createMatchRidesHandler(
  deps: MatchRidesHandlerDependencies,
): (req: Request, res: Response) => Promise<void> {
  return async function matchRidesHandler(
    req: Request,
    res: Response,
  ): Promise<void> {
    const identity = getAuthenticatedUser(res);
    const body = parseRequest(matchRidesSchema, req.body);

    // Phase 3.24 (Reporting & Blocking, §13 — DECIDED): matching's candidate
    // pool comes from discovery, so passing viewerId here also excludes an
    // actively-blocked pair from matching results.
    const candidates = await discoverRides({
      latitude: body.discovery.latitude,
      longitude: body.discovery.longitude,
      radiusMeters: deps.matchingConfig.pickupRadiusMeters,
      limit: deps.matchingMaxResults,
      viewerId: identity.userId,
    });
    const matches = matchRides(
      {
        destination: body.destination,
        preferredDepartureTime: body.preferredDepartureTime,
        requestedSeats: body.requestedSeats,
      },
      candidates,
      deps.matchingConfig,
      deps.matchingMaxResults,
    );
    sendData(res, 200, matches);
  };
}

/** POST /api/v1/rides/:rideId/requests — the authenticated user is the requester. */
export async function createRideRequestHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const { rideId } = parseRequest(rideIdPathSchema, req.params);
  const body = parseRequest(createRideRequestSchema, req.body);

  const request = await createRideRequest({
    rideId,
    requesterId: identity.userId,
    requestedSeats: body.requestedSeats,
  });
  sendData(res, 201, request);
}

/** POST /api/v1/rides/:rideId/requests/:requestId/accept — creator only. */
export async function acceptRideRequestHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const { requestId } = parseRequest(requestDecisionPathSchema, req.params);

  const result = await acceptRideRequest({
    requestId,
    actorId: identity.userId,
  });
  sendData(res, 200, result);
}

/** POST /api/v1/rides/:rideId/requests/:requestId/reject — creator only. */
export async function rejectRideRequestHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const { requestId } = parseRequest(requestDecisionPathSchema, req.params);

  const result = await rejectRideRequest({
    requestId,
    actorId: identity.userId,
  });
  sendData(res, 200, result);
}

/**
 * POST /api/v1/rides/:rideId/requests/:requestId/cancel — the requester only.
 *
 * Handles both canonical cases (`ride-lifecycle.md` §4.2): a PENDING request
 * withdrawal and an ACCEPTED participation cancellation (with seat release and
 * the last-participant CONFIRMED → PUBLISHED revert).
 */
export async function cancelRideRequestHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const { requestId } = parseRequest(requestDecisionPathSchema, req.params);

  const result = await cancelRideRequest({
    requestId,
    actorId: identity.userId,
  });
  sendData(res, 200, result);
}

/** POST /api/v1/rides/:rideId/cancel — creator only. */
export async function cancelRideHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const { rideId } = parseRequest(rideIdPathSchema, req.params);

  const result = await cancelRide({
    rideId,
    actorId: identity.userId,
  });
  sendData(res, 200, result);
}

/** GET /api/v1/rides/mine — the authenticated creator's own rides. */
export async function listCreatorRidesHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);

  const rides = await listCreatorRides({ actorId: identity.userId });
  sendData(res, 200, rides);
}

/** GET /api/v1/rides/:rideId — creator-only detail (rides the actor created). */
export async function getCreatorRideHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const { rideId } = parseRequest(rideIdPathSchema, req.params);

  const ride = await getCreatorRide({
    rideId,
    actorId: identity.userId,
  });
  sendData(res, 200, ride);
}

/** POST /api/v1/rides/:rideId/publish — creator only (DRAFT → PUBLISHED). */
export async function publishRideHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const { rideId } = parseRequest(rideIdPathSchema, req.params);

  const result = await publishRide({
    rideId,
    actorId: identity.userId,
  });
  sendData(res, 200, result);
}

/** POST /api/v1/rides/:rideId/start — creator only (PUBLISHED|CONFIRMED → IN_PROGRESS). */
export async function startRideHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const { rideId } = parseRequest(rideIdPathSchema, req.params);

  const result = await startRide({
    rideId,
    actorId: identity.userId,
  });
  sendData(res, 200, result);
}

/** POST /api/v1/rides/:rideId/complete — creator only (IN_PROGRESS → COMPLETED). */
export async function completeRideHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const { rideId } = parseRequest(rideIdPathSchema, req.params);

  const result = await completeRide({
    rideId,
    actorId: identity.userId,
  });
  sendData(res, 200, result);
}
