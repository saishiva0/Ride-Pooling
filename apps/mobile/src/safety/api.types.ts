/**
 * Safety API wire types (Phase 3.24 — Reporting & Blocking).
 *
 * Structurally mirrors the authoritative backend HTTP payloads
 * (`apps/backend/src/modules/safety/http/safety.controller.ts`'s
 * `serializeReport` / `serializeBlock`, and `listMyBlocksHandler`'s inline
 * projection). Dates arrive as ISO-8601 strings and are parsed into `Date`
 * objects by the pure mappers (`mappers.ts`); mobile models live in
 * `types.ts`. This layer is deliberately a faithful copy of the backend
 * contract — no business rules or invented fields.
 *
 * Backend source of truth:
 * - `apps/backend/src/modules/safety/http/safety.controller.ts`
 * - `apps/backend/src/modules/safety/http/safety.schemas.ts`
 * - `apps/backend/prisma/schema.prisma` (`ReportReason` enum — the exact six
 *   values below, never invented client-side)
 */

/** The six report reasons (`@prisma/client` `ReportReason`). Do not invent
 * additional values — the backend rejects anything else with 400. */
export type ReportReasonValue =
  | 'UNSAFE_BEHAVIOR'
  | 'HARASSMENT'
  | 'NO_SHOW'
  | 'FRAUD_OR_SCAM'
  | 'INAPPROPRIATE_CONTENT'
  | 'OTHER';

/** Response of `POST /api/v1/reports` and each entry of
 * `GET /api/v1/reports/mine` (backend `serializeReport`). */
export interface ReportDto {
  id: string;
  reportedUserId: string;
  rideId: string | null;
  reason: ReportReasonValue;
  detail: string | null;
  createdAt: string;
}

/** Response of `POST /api/v1/blocks` (backend `serializeBlock`). */
export interface BlockDto {
  id: string;
  blockedUserId: string;
  createdAt: string;
  unblockedAt: string | null;
}

/** Each entry of `GET /api/v1/blocks/mine` (backend `listMyBlocksHandler`'s
 * inline projection) — active blocks only (`unblockedAt IS NULL`). */
export interface ActiveBlockDto {
  blockedUserId: string;
  blockedUserName: string;
  createdAt: string;
}
