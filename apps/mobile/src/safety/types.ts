/**
 * Mobile safety domain models (Phase 3.24 — Reporting & Blocking).
 *
 * The mobile-facing shapes screens consume. Dates are native `Date` objects
 * (parsed from wire ISO strings by `mappers.ts`); no wire/HTTP concerns leak
 * into screens.
 *
 * Identity is deliberately absent from every input the mobile layer sends:
 * no `reporterId`/`blockerId` is ever carried by a request payload — the
 * backend derives the actor from the authenticated headers supplied by the
 * API client's `AuthHeadersProvider` (Phase 3.14).
 *
 * Scope: only ride co-participants may report/block each other
 * (`docs/planning/phases/phase-3-24.md` §5/§9/§11/§13 — DECIDED, Product
 * owner decision 2026-08-21). The backend enforces this server-side (403 on
 * violation); the mobile UI only ever surfaces the report/block action from
 * a context where the target is already a known ride co-participant (the
 * ride details screen), never as a generic "report any user" flow.
 */
import type { ReportReasonValue } from './api.types';

export type { ReportReasonValue };

/** A report the authenticated user filed. */
export interface Report {
  id: string;
  reportedUserId: string;
  rideId: string | null;
  reason: ReportReasonValue;
  detail: string | null;
  createdAt: Date;
}

/** The result of the authenticated user blocking another user. Idempotent
 * on the backend: re-blocking an already-active block, or a previously
 * unblocked pair, reactivates/no-ops rather than erroring (§13, DECIDED). */
export interface Block {
  id: string;
  blockedUserId: string;
  createdAt: Date;
  unblockedAt: Date | null;
}

/** One entry in the authenticated user's currently-active block list
 * (`GET /api/v1/blocks/mine` — already-inactive/unblocked pairs are
 * excluded server-side). */
export interface ActiveBlock {
  blockedUserId: string;
  blockedUserName: string;
  createdAt: Date;
}

/** Human-readable labels for the `ReportReason` enum (backend
 * `apps/backend/prisma/schema.prisma`) — the reason picker's exact option
 * set. No reason is invented beyond these six values. */
export const REPORT_REASONS: ReadonlyArray<{
  value: ReportReasonValue;
  label: string;
}> = [
  { value: 'UNSAFE_BEHAVIOR', label: 'Unsafe behavior' },
  { value: 'HARASSMENT', label: 'Harassment' },
  { value: 'NO_SHOW', label: 'No-show' },
  { value: 'FRAUD_OR_SCAM', label: 'Fraud or scam' },
  { value: 'INAPPROPRIATE_CONTENT', label: 'Inappropriate content' },
  { value: 'OTHER', label: 'Other' },
];
