/**
 * Pure wire → mobile mappers (Phase 3.24 — Reporting & Blocking).
 *
 * Every function is pure and deterministic: it takes a backend wire payload
 * (`api.types.ts`) and produces a mobile model (`types.ts`). The only
 * transformation is ISO date parsing into native `Date` objects and field
 * projection — matching `ride/mappers.ts`'s established pattern. No
 * validation is duplicated here and no business logic is invented.
 */
import type { ActiveBlockDto, BlockDto, ReportDto } from './api.types';
import type { ActiveBlock, Block, Report } from './types';

/** Parses an ISO-8601 wire datetime into a `Date`. */
export function parseIsoDate(value: string): Date {
  return new Date(value);
}

/** Maps a report payload (from either `POST /reports` or
 * `GET /reports/mine`) to the mobile model. */
export function mapReport(dto: ReportDto): Report {
  return {
    id: dto.id,
    reportedUserId: dto.reportedUserId,
    rideId: dto.rideId,
    reason: dto.reason,
    detail: dto.detail,
    createdAt: parseIsoDate(dto.createdAt),
  };
}

/** Maps a block payload (`POST /blocks`) to the mobile model. */
export function mapBlock(dto: BlockDto): Block {
  return {
    id: dto.id,
    blockedUserId: dto.blockedUserId,
    createdAt: parseIsoDate(dto.createdAt),
    unblockedAt:
      dto.unblockedAt === null ? null : parseIsoDate(dto.unblockedAt),
  };
}

/** Maps one `GET /blocks/mine` entry to the mobile model. */
export function mapActiveBlock(dto: ActiveBlockDto): ActiveBlock {
  return {
    blockedUserId: dto.blockedUserId,
    blockedUserName: dto.blockedUserName,
    createdAt: parseIsoDate(dto.createdAt),
  };
}
