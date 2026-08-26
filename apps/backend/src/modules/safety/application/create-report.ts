/**
 * Report creation use case (Phase 3.24 — Reporting & Blocking).
 *
 * Creates an immutable `Report` row against a ride co-participant. Flow:
 *
 *   validate input shape
 *   → self-report rule (reportedId === reporterId → ValidationError, 400)
 *   → rate limit (5 reports / rolling 24h per reporter, §11 — DECIDED
 *     threshold → RateLimitError, 429)
 *   → reported user must exist (→ NotFoundError, 404 — checked BEFORE the
 *     co-participant scope check, per §14's proposed ordering, so a
 *     nonexistent target yields 404 rather than 403)
 *   → ride-co-participant scope check (→ AuthorizationError, 403 — DECIDED,
 *     Product owner decision, 2026-08-21)
 *   → insert the report
 *
 * No notification, push, or realtime event is ever triggered by a report
 * (§16 — DECIDED, fully silent). No status/lifecycle field exists on
 * `Report` (§13 — DECIDED to omit).
 */
import type { ReportReason } from '@prisma/client';
import {
  AppError,
  AuthorizationError,
  InternalError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import {
  REPORT_RATE_LIMIT_MAX,
  REPORT_RATE_LIMIT_WINDOW_MS,
  isSelfTarget,
} from '../domain/safety-rules.js';
import { areRideCoParticipants } from '../infrastructure/co-participant.repository.js';
import {
  countRecentReportsByReporter,
  persistReport,
  classifyReportError,
  type ReportRow,
} from '../infrastructure/report.repository.js';

export type { ReportRow } from '../infrastructure/report.repository.js';

/** The reporting user's trusted input. `reporterId` always comes from auth. */
export interface CreateReportInput {
  reporterId: string;
  reportedId: string;
  reason: ReportReason;
  detail?: string;
  rideId?: string;
}

/** The created report, shaped for application-layer consumers. */
export interface CreatedReport {
  id: string;
  reporterId: string;
  reportedId: string;
  rideId: string | null;
  reason: ReportReason;
  detail: string | null;
  createdAt: Date;
}

/**
 * Persistence port used by `createReport`, implemented by the
 * infrastructure layer inside a single database transaction.
 */
export interface ReportPersistence {
  findReportedUser(userId: string): Promise<{ id: string } | null>;
  countRecentReports(reporterId: string, sinceDate: Date): Promise<number>;
  areCoParticipants(userA: string, userB: string): Promise<boolean>;
  createReport(params: {
    reporterId: string;
    reportedId: string;
    reason: ReportReason;
    detail?: string | null;
    rideId?: string | null;
  }): Promise<ReportRow>;
  classifyError(err: unknown): 'foreign_key' | null;
}

/** Injected dependency so the use case is unit-testable without PostgreSQL. */
export interface CreateReportDependencies {
  runTransaction: <T>(
    work: (persistence: ReportPersistence) => Promise<T>,
  ) => Promise<T>;
  /** Injectable clock so the rolling rate-limit window is deterministic in tests. */
  now: () => Date;
  /** Tunable rate-limit policy (§11 — DECIDED 5/24h; never hardcoded inline at the call site). */
  rateLimit: { max: number; windowMs: number };
}

function defaultDependencies(): CreateReportDependencies {
  return {
    runTransaction: (work) =>
      prisma.$transaction((tx) =>
        work({
          findReportedUser: (userId) =>
            tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
          countRecentReports: (reporterId, sinceDate) =>
            countRecentReportsByReporter(tx, reporterId, sinceDate),
          areCoParticipants: (userA, userB) =>
            areRideCoParticipants(tx, userA, userB),
          createReport: (params) => persistReport(tx, params),
          classifyError: classifyReportError,
        }),
      ),
    now: () => new Date(),
    rateLimit: {
      max: REPORT_RATE_LIMIT_MAX,
      windowMs: REPORT_RATE_LIMIT_WINDOW_MS,
    },
  };
}

function assertValidInput(input: CreateReportInput): void {
  if (typeof input.reporterId !== 'string' || input.reporterId.trim() === '') {
    throw new ValidationError('reporterId is required', {
      field: 'reporterId',
    });
  }
  if (typeof input.reportedId !== 'string' || input.reportedId.trim() === '') {
    throw new ValidationError('reportedUserId is required', {
      field: 'reportedUserId',
    });
  }
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

/**
 * Creates a report against a ride co-participant.
 *
 * Throws `ValidationError` (malformed input / self-report), `RateLimitError`
 * (429 — over the rolling 24h threshold), `NotFoundError` (404 — reported
 * user does not exist), `AuthorizationError` (403 — caller and target are
 * not ride co-participants), or `InternalError` for unexpected persistence
 * failures (never a raw Prisma error).
 */
export async function createReport(
  input: CreateReportInput,
  deps: Partial<CreateReportDependencies> = {},
): Promise<CreatedReport> {
  const { runTransaction, now, rateLimit } = {
    ...defaultDependencies(),
    ...deps,
  };

  assertValidInput(input);

  if (isSelfTarget(input.reporterId, input.reportedId)) {
    throw new ValidationError('You cannot report yourself', {
      field: 'reportedUserId',
    });
  }

  return runTransaction(async (persistence) => {
    const sinceDate = new Date(now().getTime() - rateLimit.windowMs);
    const recentCount = await persistence.countRecentReports(
      input.reporterId,
      sinceDate,
    );
    if (recentCount >= rateLimit.max) {
      throw new RateLimitError(
        'Too many reports filed recently. Please try again later.',
      );
    }

    const reportedUser = await persistence.findReportedUser(input.reportedId);
    if (!reportedUser) {
      throw new NotFoundError('Reported user not found', {
        field: 'reportedUserId',
        details: { reportedUserId: input.reportedId },
      });
    }

    const eligible = await persistence.areCoParticipants(
      input.reporterId,
      input.reportedId,
    );
    if (!eligible) {
      throw new AuthorizationError(
        'You can only report a user you have shared a ride with',
      );
    }

    try {
      const record = await persistence.createReport({
        reporterId: input.reporterId,
        reportedId: input.reportedId,
        reason: input.reason,
        detail: input.detail ?? null,
        rideId: input.rideId ?? null,
      });
      return toCreatedReport(record);
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      const kind = persistence.classifyError(err);
      if (kind === 'foreign_key') {
        throw new NotFoundError('Reported user or ride not found', {
          field: 'reportedUserId',
        });
      }
      throw new InternalError('Failed to create report', { cause: err });
    }
  });
}
