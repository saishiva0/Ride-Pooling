import { Router } from 'express';
import type { HealthResponse } from '@ridepool/shared';
import { HEALTH_PATH, SERVICE_NAME } from '@ridepool/shared';

/**
 * Health endpoint — non-versioned, outside the /api/v1 business namespace
 * (per `docs/architecture/api-boundaries.md`).
 */
export function healthRouter(): Router {
  const router = Router();

  router.get(HEALTH_PATH, (_req, res) => {
    const body: HealthResponse = {
      status: 'ok',
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
    };
    res.json(body);
  });

  return router;
}
