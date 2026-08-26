/**
 * Safety HTTP request schemas (Phase 3.24 — Reporting & Blocking).
 *
 * Zod validation at the HTTP boundary ONLY: required fields, primitive
 * types, the `ReportReason` enum shape. Business rules (self-report/
 * self-block, ride-co-participant scoping, rate limiting) stay in the
 * application/domain layer, which remains authoritative.
 */
import { z } from 'zod';
import { ReportReason } from '@prisma/client';

/** POST /api/v1/reports — body. */
export const createReportSchema = z.object({
  reportedUserId: z.string().trim().min(1),
  reason: z.nativeEnum(ReportReason),
  detail: z.string().trim().min(1).max(2000).optional(),
  rideId: z.string().trim().min(1).optional(),
});

/** POST /api/v1/blocks — body. */
export const createBlockSchema = z.object({
  blockedUserId: z.string().trim().min(1),
});

/** DELETE /api/v1/blocks/:blockedUserId — path parameter. */
export const blockedUserIdPathSchema = z.object({
  blockedUserId: z.string().trim().min(1),
});
