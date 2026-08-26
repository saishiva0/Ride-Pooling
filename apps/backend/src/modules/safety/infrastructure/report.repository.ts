/**
 * Report persistence (Phase 3.24 — Reporting & Blocking).
 *
 * The only persistence concern this module owns for reports: creating a
 * report, counting a reporter's recent rows (the rate-limit query, §11), and
 * listing a reporter's own filed reports (§10 `GET /reports/mine`). No
 * status/lifecycle field exists on `Report` (§13 — DECIDED to omit, no
 * admin/moderation consumer yet).
 */
import { Prisma, ReportReason } from '@prisma/client';

/** The raw persisted report row returned to callers. */
export interface ReportRow {
  id: string;
  reporterId: string;
  reportedId: string;
  rideId: string | null;
  reason: ReportReason;
  detail: string | null;
  createdAt: Date;
}

/** Everything required to persist a report. */
export interface ReportCreationParams {
  reporterId: string;
  reportedId: string;
  reason: ReportReason;
  detail?: string | null;
  rideId?: string | null;
}

const REPORT_SELECT = {
  id: true,
  reporterId: true,
  reportedId: true,
  rideId: true,
  reason: true,
  detail: true,
  createdAt: true,
} as const;

/** Inserts a report inside the caller's transaction. */
export async function persistReport(
  tx: Prisma.TransactionClient,
  params: ReportCreationParams,
): Promise<ReportRow> {
  return tx.report.create({
    data: {
      reporterId: params.reporterId,
      reportedId: params.reportedId,
      reason: params.reason,
      detail: params.detail ?? null,
      rideId: params.rideId ?? null,
    },
    select: REPORT_SELECT,
  });
}

/**
 * Counts a reporter's report rows created since `sinceDate` — the rolling
 * 24h rate-limit query (§11, DECIDED threshold), backed by the
 * `Report_reporterId_createdAt_idx` composite index.
 */
export async function countRecentReportsByReporter(
  client: Prisma.TransactionClient,
  reporterId: string,
  sinceDate: Date,
): Promise<number> {
  return client.report.count({
    where: { reporterId, createdAt: { gte: sinceDate } },
  });
}

/**
 * Lists a reporter's own filed reports, newest first (§10
 * `GET /reports/mine`). Deterministic ordering via an `id` tiebreak.
 */
export async function findReportsByReporter(
  client: Prisma.TransactionClient,
  reporterId: string,
): Promise<ReportRow[]> {
  return client.report.findMany({
    where: { reporterId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: REPORT_SELECT,
  });
}

/**
 * Classifies a Prisma error thrown by a report insert so the application
 * layer can translate a race (the reported user or ride vanished between
 * validation and insert, P2003) into its own error structure — never a raw
 * Prisma error.
 */
export function classifyReportError(err: unknown): 'foreign_key' | null {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2003'
  ) {
    return 'foreign_key';
  }
  return null;
}
