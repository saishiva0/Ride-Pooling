/**
 * Machine-readable health response contract (see
 * `docs/architecture/api-boundaries.md`).
 */
export const SERVICE_NAME = 'ridepool-api' as const;

export type HealthStatus = 'ok';

export interface HealthResponse {
  status: HealthStatus;
  service: typeof SERVICE_NAME;
  timestamp: string;
}
