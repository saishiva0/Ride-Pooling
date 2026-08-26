/**
 * Unit tests for the Phase 3.24 report creation use case.
 *
 * No PostgreSQL required: the `runTransaction` persistence port is faked.
 * Covers input validation, self-report rejection, the rolling-24h rate
 * limit (5/24h, DECIDED), target existence, ride-co-participant scoping
 * (403, DECIDED), the 404-before-403 ordering, and error translation.
 */
import { describe, expect, it, vi } from 'vitest';
import { ReportReason } from '@prisma/client';
import {
  AuthorizationError,
  InternalError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '../../../lib/errors.js';
import { createReport } from './create-report.js';
import type {
  CreateReportDependencies,
  CreatedReport,
  ReportPersistence,
} from './create-report.js';
import type { ReportRow } from '../infrastructure/report.repository.js';

function fakePersistence(
  overrides: Partial<ReportPersistence> = {},
): ReportPersistence {
  return {
    findReportedUser: vi.fn(),
    countRecentReports: vi.fn(),
    areCoParticipants: vi.fn(),
    createReport: vi.fn(),
    classifyError: vi.fn(() => null),
    ...overrides,
  };
}

const reporterId = 'user-1';
const reportedId = 'user-2';

function reportRow(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: 'report-1',
    reporterId,
    reportedId,
    rideId: null,
    reason: ReportReason.HARASSMENT,
    detail: null,
    createdAt: new Date('2026-08-21T10:00:00.000Z'),
    ...overrides,
  };
}

function happyPersistence(): ReportPersistence {
  return fakePersistence({
    findReportedUser: vi.fn().mockResolvedValue({ id: reportedId }),
    countRecentReports: vi.fn().mockResolvedValue(0),
    areCoParticipants: vi.fn().mockResolvedValue(true),
    createReport: vi
      .fn()
      .mockImplementation((params: { reason: ReportReason }) =>
        reportRow({ reason: params.reason }),
      ),
  });
}

async function run(
  persistence: ReportPersistence,
  overrides: Partial<Parameters<typeof createReport>[0]> = {},
  now: () => Date = () => new Date('2026-08-21T12:00:00.000Z'),
): Promise<CreatedReport> {
  return createReport(
    {
      reporterId,
      reportedId,
      reason: ReportReason.HARASSMENT,
      ...overrides,
    },
    {
      runTransaction: async (work) => work(persistence),
      now,
      rateLimit: { max: 5, windowMs: 24 * 60 * 60 * 1000 },
    },
  );
}

describe('createReport — happy path', () => {
  it('creates a report and maps the result deterministically', async () => {
    const persistence = happyPersistence();
    const result = await run(persistence, {
      detail: 'was rude',
      rideId: 'ride-1',
    });

    expect(result).toEqual({
      id: 'report-1',
      reporterId,
      reportedId,
      rideId: null,
      reason: ReportReason.HARASSMENT,
      detail: null,
      createdAt: new Date('2026-08-21T10:00:00.000Z'),
    });
    expect(persistence.createReport).toHaveBeenCalledWith({
      reporterId,
      reportedId,
      reason: ReportReason.HARASSMENT,
      detail: 'was rude',
      rideId: 'ride-1',
    });
  });

  it('defaults detail/rideId to null when omitted', async () => {
    const persistence = happyPersistence();
    await run(persistence);
    expect(persistence.createReport).toHaveBeenCalledWith(
      expect.objectContaining({ detail: null, rideId: null }),
    );
  });
});

describe('createReport — self-report rule', () => {
  it('rejects reporting yourself with a 400 ValidationError', async () => {
    const persistence = happyPersistence();
    await expect(
      run(persistence, { reportedId: reporterId }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(persistence.createReport).not.toHaveBeenCalled();
  });
});

describe('createReport — input validation', () => {
  it('rejects a missing reporterId/reportedId before touching persistence', async () => {
    const runTransaction = vi.fn();
    const deps: Partial<CreateReportDependencies> = { runTransaction };

    await expect(
      createReport(
        { reporterId: '', reportedId, reason: ReportReason.OTHER },
        deps,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createReport(
        { reporterId, reportedId: '  ', reason: ReportReason.OTHER },
        deps,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('createReport — rate limit (§11, DECIDED: 5 per rolling 24h)', () => {
  it('allows the 5th report when 4 already exist in the window', async () => {
    const persistence = happyPersistence();
    persistence.countRecentReports = vi.fn().mockResolvedValue(4);

    await expect(run(persistence)).resolves.toMatchObject({ id: 'report-1' });
  });

  it('rejects the 6th report within the rolling 24h window with 429', async () => {
    const persistence = happyPersistence();
    persistence.countRecentReports = vi.fn().mockResolvedValue(5);

    await expect(run(persistence)).rejects.toBeInstanceOf(RateLimitError);
    expect(persistence.createReport).not.toHaveBeenCalled();
  });

  it('computes the rolling window from the injectable clock', async () => {
    const persistence = happyPersistence();
    const now = () => new Date('2026-08-21T12:00:00.000Z');

    await run(persistence, {}, now);

    expect(persistence.countRecentReports).toHaveBeenCalledWith(
      reporterId,
      new Date('2026-08-20T12:00:00.000Z'),
    );
  });
});

describe('createReport — target existence and co-participant scope', () => {
  it('rejects a nonexistent target with 404, before the co-participant check', async () => {
    const persistence = happyPersistence();
    persistence.findReportedUser = vi.fn().mockResolvedValue(null);
    persistence.areCoParticipants = vi.fn();

    await expect(run(persistence)).rejects.toBeInstanceOf(NotFoundError);
    expect(persistence.areCoParticipants).not.toHaveBeenCalled();
    expect(persistence.createReport).not.toHaveBeenCalled();
  });

  it('rejects a non-co-participant target with 403 (DECIDED scope restriction)', async () => {
    const persistence = happyPersistence();
    persistence.areCoParticipants = vi.fn().mockResolvedValue(false);

    await expect(run(persistence)).rejects.toBeInstanceOf(AuthorizationError);
    expect(persistence.createReport).not.toHaveBeenCalled();
  });

  it('allows a report when the target IS a ride co-participant', async () => {
    const persistence = happyPersistence();
    persistence.areCoParticipants = vi.fn().mockResolvedValue(true);

    await expect(run(persistence)).resolves.toMatchObject({ id: 'report-1' });
  });
});

describe('createReport — error translation', () => {
  it('translates a foreign-key race into a NotFoundError', async () => {
    const persistence = happyPersistence();
    persistence.createReport = vi.fn().mockRejectedValue(new Error('P2003'));
    persistence.classifyError = vi.fn(
      (_err: unknown): 'foreign_key' | null => 'foreign_key',
    );

    await expect(run(persistence)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('wraps an unexpected persistence failure without leaking it directly', async () => {
    const persistence = happyPersistence();
    persistence.createReport = vi
      .fn()
      .mockRejectedValue(new Error('connection reset by peer'));

    const promise = run(persistence);
    await expect(promise).rejects.toBeInstanceOf(InternalError);
    await expect(promise).rejects.not.toThrow('connection reset by peer');
  });
});
