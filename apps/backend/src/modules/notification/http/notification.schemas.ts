/**
 * Notification HTTP request schemas (Phase 3.10).
 *
 * Zod validation at the HTTP boundary only. The application layer owns
 * business behavior; `unreadOnly`/cursor pagination are intentionally NOT
 * added because the existing application layer does not support them
 * (Phase 3.10 notes §3).
 */
import { z } from 'zod';

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

/** GET /api/v1/notifications — query parameters. */
export const listNotificationsQuerySchema = z.object({
  limit: numericQuery('limit').optional(),
});

/** PATCH /api/v1/notifications/:notificationId/read — path parameter. */
export const notificationIdPathSchema = z.object({
  notificationId: z.string().trim().min(1),
});
