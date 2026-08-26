/**
 * Ride HTTP request schemas (Phase 3.10).
 *
 * Zod validation at the HTTP boundary ONLY: required fields, primitive
 * types, numeric/date parsing, basic shape. Business rules (seat/price
 * ranges, coordinate bounds, ride states, OD-004 thresholds) stay in the
 * application/domain layer, which remains authoritative — this layer never
 * duplicates them (Phase 3.10 notes §7).
 *
 * PricingType values match `docs/domain/pricing-model.md` §2 (STANDARD |
 * CUSTOM); the domain layer re-exports the Prisma enum.
 */
import { z } from 'zod';

/** An ISO-8601 datetime string with an offset → parsed `Date`. */
const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

/** A coordinate pair (bounds validated by the domain, not here). */
const coordinatesSchema = z.object({
  latitude: z.number().finite(),
  longitude: z.number().finite(),
});

/** Query-parameter number: Express gives strings; parse safely. */
function numericQuery(field: string) {
  return z
    .string()
    .trim()
    .min(1, `${field} is required`)
    .transform((value, ctx) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} must be a number`,
        });
        return z.NEVER;
      }
      return parsed;
    })
    .pipe(z.number());
}

/** POST /api/v1/rides — ride creation body. */
export const createRideSchema = z.object({
  pickup: coordinatesSchema.extend({
    label: z.string().max(255).optional(),
  }),
  destination: coordinatesSchema.extend({
    label: z.string().max(255).optional(),
  }),
  departureDateTime: isoDateTime,
  totalSeats: z.number().int().positive(),
  vehicleType: z.string().min(1).max(64).optional(),
  discoveryRadiusKm: z.number().finite().optional(),
  pricingType: z.enum(['STANDARD', 'CUSTOM']),
  pricePerKm: z.number().finite(),
  estimatedDistanceKm: z.number().finite().optional(),
  estimatedContribution: z.number().finite().optional(),
});

/** GET /api/v1/rides/discover — query parameters. */
export const discoverRidesQuerySchema = z.object({
  latitude: numericQuery('latitude'),
  longitude: numericQuery('longitude'),
  radiusMeters: numericQuery('radiusMeters'),
  limit: numericQuery('limit').optional(),
});

/**
 * POST /api/v1/rides/match — matching request body.
 *
 * Strict by design: `discovery` is the participant's pickup point only, and
 * the matching thresholds/limits are server-controlled product policy
 * (OD-004 — resolved Phase 3.19). The schema is `.strict()` so any
 * caller-supplied policy (e.g. a `matching` block, `radiusMeters`,
 * `discovery.limit`, ranking/weights/score) is rejected with a 400 instead
 * of silently accepted. `destination` / `preferredDepartureTime` /
 * `requestedSeats` are the participant's journey
 * (`domain/matching/types.ts`).
 */
export const matchRidesSchema = z
  .object({
    discovery: z
      .object({
        latitude: z.number().finite(),
        longitude: z.number().finite(),
      })
      .strict(),
    destination: coordinatesSchema,
    preferredDepartureTime: isoDateTime,
    requestedSeats: z.number().int().positive().optional(),
  })
  .strict();

/** POST /api/v1/rides/:rideId/requests — request creation body. */
export const createRideRequestSchema = z.object({
  requestedSeats: z.number().int().positive().optional(),
});

/** Path parameter schemas (cuid strings — existence is the app layer's job). */
export const rideIdPathSchema = z.object({
  rideId: z.string().trim().min(1),
});

export const requestDecisionPathSchema = z.object({
  rideId: z.string().trim().min(1),
  requestId: z.string().trim().min(1),
});
