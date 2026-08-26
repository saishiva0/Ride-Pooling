/**
 * Real-database integration tests for Phase 3.24 report persistence:
 * creation, the rolling-24h rate-limit count, listing a reporter's own
 * reports, and FK-race classification.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { Prisma, ReportReason } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import {
  classifyReportError,
  countRecentReportsByReporter,
  findReportsByReporter,
  persistReport,
} from './report.repository.js';

const RUN_ID = `reporttest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let seq = 0;
function unique(label: string): string {
  seq += 1;
  return `${RUN_ID}_${label}_${seq}`;
}

const cleanup = { reportIds: [] as string[], userIds: [] as string[] };

afterAll(async () => {
  await prisma.report.deleteMany({ where: { id: { in: cleanup.reportIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.$disconnect();
});

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: { name: `Test ${label}`, phone: `+91${unique(label)}` },
  });
  cleanup.userIds.push(user.id);
  return user;
}

describe('persistReport / findReportsByReporter — real database integration', () => {
  it('creates a report and lists it for the reporter, newest first', async () => {
    const reporter = await createUser('reporter');
    const reported = await createUser('reported');

    const first = await prisma.$transaction((tx) =>
      persistReport(tx, {
        reporterId: reporter.id,
        reportedId: reported.id,
        reason: ReportReason.HARASSMENT,
        detail: 'first',
      }),
    );
    cleanup.reportIds.push(first.id);
    const second = await prisma.$transaction((tx) =>
      persistReport(tx, {
        reporterId: reporter.id,
        reportedId: reported.id,
        reason: ReportReason.NO_SHOW,
        detail: 'second',
      }),
    );
    cleanup.reportIds.push(second.id);

    expect(first.rideId).toBeNull();
    expect(first.reason).toBe(ReportReason.HARASSMENT);

    const listed = await prisma.$transaction((tx) =>
      findReportsByReporter(tx, reporter.id),
    );
    expect(listed.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it("does not list another reporter's reports", async () => {
    const reporterA = await createUser('scope-a');
    const reporterB = await createUser('scope-b');
    const target = await createUser('scope-target');

    const report = await prisma.$transaction((tx) =>
      persistReport(tx, {
        reporterId: reporterA.id,
        reportedId: target.id,
        reason: ReportReason.OTHER,
      }),
    );
    cleanup.reportIds.push(report.id);

    const listedForB = await prisma.$transaction((tx) =>
      findReportsByReporter(tx, reporterB.id),
    );
    expect(listedForB).toHaveLength(0);
  });
});

describe('countRecentReportsByReporter — rolling window (§11, DECIDED)', () => {
  it('counts only reports created since the given date', async () => {
    const reporter = await createUser('rate-limit-count');
    const target = await createUser('rate-limit-target');

    const report = await prisma.$transaction((tx) =>
      persistReport(tx, {
        reporterId: reporter.id,
        reportedId: target.id,
        reason: ReportReason.OTHER,
      }),
    );
    cleanup.reportIds.push(report.id);

    const countIncludingIt = await countRecentReportsByReporter(
      prisma,
      reporter.id,
      new Date(Date.now() - 60_000),
    );
    expect(countIncludingIt).toBe(1);

    const countExcludingIt = await countRecentReportsByReporter(
      prisma,
      reporter.id,
      new Date(Date.now() + 60_000),
    );
    expect(countExcludingIt).toBe(0);
  });
});

describe('classifyReportError', () => {
  it('classifies a P2003 foreign-key violation', () => {
    const err = new Prisma.PrismaClientKnownRequestError('FK violation', {
      code: 'P2003',
      clientVersion: 'test',
    });
    expect(classifyReportError(err)).toBe('foreign_key');
  });

  it('returns null for an unrelated error', () => {
    expect(classifyReportError(new Error('boom'))).toBeNull();
  });
});
