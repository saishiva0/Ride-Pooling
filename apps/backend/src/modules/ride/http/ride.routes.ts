/**
 * Ride HTTP routes (Phase 3.10).
 *
 * Canonical paths from `docs/development/phase-3-10-notes.md` §3. Every
 * business endpoint is authenticated at the HTTP boundary (`requireAuth`
 * built by `createAuthMiddleware`); no business logic lives here — routes
 * only wire middleware to thin controllers.
 */
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { asyncHandler } from '../../api/async-handler.js';
import type { MatchingConfiguration } from '../domain/matching/types.js';
import {
  acceptRideRequestHandler,
  cancelRideHandler,
  cancelRideRequestHandler,
  completeRideHandler,
  createMatchRidesHandler,
  createRideHandler,
  createRideRequestHandler,
  discoverRidesHandler,
  getCreatorRideHandler,
  listCreatorRidesHandler,
  publishRideHandler,
  rejectRideRequestHandler,
  startRideHandler,
} from './ride.controller.js';

export interface RideRouterOptions {
  /** The authentication middleware produced by `createAuthMiddleware`. */
  requireAuth: RequestHandler;
  /** Server-controlled matching thresholds (OD-004 — resolved Phase 3.19). */
  matchingConfig: MatchingConfiguration;
  /** Server-owned matching result cap (OD-004, default 20). */
  matchingMaxResults: number;
}

export function createRideRouter(options: RideRouterOptions): Router {
  const { requireAuth, matchingConfig, matchingMaxResults } = options;
  const router = Router();
  const matchRidesHandler = createMatchRidesHandler({
    matchingConfig,
    matchingMaxResults,
  });

  router.post('/rides', requireAuth, asyncHandler(createRideHandler));
  router.get(
    '/rides/discover',
    requireAuth,
    asyncHandler(discoverRidesHandler),
  );
  // `/rides/mine` MUST be registered before `/rides/:rideId` so the literal
  // path wins over the parameterized one (Express matches in registration
  // order) — see Phase 3.17 canonical spec §5.
  router.get('/rides/mine', requireAuth, asyncHandler(listCreatorRidesHandler));
  router.get(
    '/rides/:rideId',
    requireAuth,
    asyncHandler(getCreatorRideHandler),
  );
  router.post('/rides/match', requireAuth, asyncHandler(matchRidesHandler));
  router.post(
    '/rides/:rideId/requests',
    requireAuth,
    asyncHandler(createRideRequestHandler),
  );
  router.post(
    '/rides/:rideId/requests/:requestId/accept',
    requireAuth,
    asyncHandler(acceptRideRequestHandler),
  );
  router.post(
    '/rides/:rideId/requests/:requestId/reject',
    requireAuth,
    asyncHandler(rejectRideRequestHandler),
  );
  router.post(
    '/rides/:rideId/requests/:requestId/cancel',
    requireAuth,
    asyncHandler(cancelRideRequestHandler),
  );
  router.post(
    '/rides/:rideId/cancel',
    requireAuth,
    asyncHandler(cancelRideHandler),
  );
  router.post(
    '/rides/:rideId/publish',
    requireAuth,
    asyncHandler(publishRideHandler),
  );
  router.post(
    '/rides/:rideId/start',
    requireAuth,
    asyncHandler(startRideHandler),
  );
  router.post(
    '/rides/:rideId/complete',
    requireAuth,
    asyncHandler(completeRideHandler),
  );

  return router;
}
