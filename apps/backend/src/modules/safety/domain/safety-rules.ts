/**
 * Safety domain rules (Phase 3.24 — Reporting & Blocking).
 *
 * Pure predicates and constants only — no I/O. Sources of truth:
 * `docs/planning/phases/phase-3-24.md` §9/§11/§13 (Product owner decision,
 * 2026-08-21).
 *
 * The ride-co-participant eligibility check itself is NOT a pure predicate
 * (it requires a database lookup spanning `Ride`/`RideParticipant`), so it
 * lives in `infrastructure/co-participant.repository.ts` instead of here.
 */

/**
 * Report rate limit: 5 reports per rolling 24-hour window per reporting
 * user (Product owner decision, 2026-08-21, §11). A tunable configuration
 * constant — never hardcoded inline at the call site, and not a schema/table
 * concept (enforced via a query against `Report.createdAt`/`reporterId`).
 */
export const REPORT_RATE_LIMIT_MAX = 5;
export const REPORT_RATE_LIMIT_WINDOW_HOURS = 24;
export const REPORT_RATE_LIMIT_WINDOW_MS =
  REPORT_RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000;

/**
 * Self-report / self-block guard (§11 — INFERENCE: an obvious guard for a
 * coherent feature, not canonically stated but proposed here as a 400).
 */
export function isSelfTarget(actorId: string, targetId: string): boolean {
  return actorId === targetId;
}
