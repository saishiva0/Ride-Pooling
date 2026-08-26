/**
 * API versioning convention.
 *
 * All business endpoints live under /api/v1. The health endpoint remains
 * outside the versioned namespace per Phase 0 (`docs/architecture/api-boundaries.md`).
 */
export const API_VERSION = 'v1' as const;

export const API_BASE_PATH = `/api/${API_VERSION}` as const;

/** Health endpoint (non-versioned). */
export const HEALTH_PATH = '/health' as const;
