/**
 * Unit test for the Phase 3.24 "my reports" listing use case (§10
 * `GET /reports/mine`, owner-scoped).
 */
import { describe, expect, it, vi } from 'vitest';
import { ReportReason } from '@prisma/client';
import { listMyReports } from './list-my-reports.js';
import type { ReportRow } from '../infrastructure/report.repository.js';

describe('listMyReports', () => {
  it('maps persisted rows to the application shape, owner-scoped', async () => {
    const row: ReportRow = {
      id: 'report-1',
      reporterId: 'user-1',
      reportedId: 'user-2',
      rideId: null,
      reason: ReportReason.NO_SHOW,
      detail: 'never showed up',
      createdAt: new Date('2026-08-21T10:00:00.000Z'),
    };
    const findReportsByReporter = vi.fn().mockResolvedValue([row]);

    const result = await listMyReports('user-1', { findReportsByReporter });

    expect(findReportsByReporter).toHaveBeenCalledWith('user-1');
    expect(result).toEqual([
      {
        id: 'report-1',
        reporterId: 'user-1',
        reportedId: 'user-2',
        rideId: null,
        reason: ReportReason.NO_SHOW,
        detail: 'never showed up',
        createdAt: new Date('2026-08-21T10:00:00.000Z'),
      },
    ]);
  });

  it('returns an empty list for a reporter with no filed reports', async () => {
    const findReportsByReporter = vi.fn().mockResolvedValue([]);
    const result = await listMyReports('user-1', { findReportsByReporter });
    expect(result).toEqual([]);
  });
});
