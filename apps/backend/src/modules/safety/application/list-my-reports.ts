/**
 * "My reports" listing use case (Phase 3.24 — Reporting & Blocking, §10
 * `GET /reports/mine`). Owner-scoped only — no GET-by-id / cross-user
 * report visibility endpoint exists (§10, consistent with no admin module).
 */
import { prisma } from '../../../lib/prisma.js';
import {
  findReportsByReporter,
  type ReportRow,
} from '../infrastructure/report.repository.js';
import type { CreatedReport } from './create-report.js';

export interface ListMyReportsDependencies {
  findReportsByReporter: (reporterId: string) => Promise<ReportRow[]>;
}

function defaultDependencies(): ListMyReportsDependencies {
  return {
    findReportsByReporter: (reporterId) =>
      findReportsByReporter(prisma, reporterId),
  };
}

function toCreatedReport(record: ReportRow): CreatedReport {
  return {
    id: record.id,
    reporterId: record.reporterId,
    reportedId: record.reportedId,
    rideId: record.rideId,
    reason: record.reason,
    detail: record.detail,
    createdAt: record.createdAt,
  };
}

/** Lists the reports `reporterId` has filed, newest first. */
export async function listMyReports(
  reporterId: string,
  deps: Partial<ListMyReportsDependencies> = {},
): Promise<CreatedReport[]> {
  const { findReportsByReporter: find } = {
    ...defaultDependencies(),
    ...deps,
  };
  const rows = await find(reporterId);
  return rows.map(toCreatedReport);
}
