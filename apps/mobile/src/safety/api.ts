/**
 * Typed safety API service (Phase 3.24 — Reporting & Blocking).
 *
 * The single typed seam between screens and the generic API client
 * (`src/api/client.ts`), matching `ride/api.ts`'s established pattern. Every
 * method maps to exactly one existing backend endpoint (already implemented
 * and merged under `apps/backend/src/modules/safety`):
 *
 *   POST   /api/v1/reports
 *   GET    /api/v1/reports/mine
 *   POST   /api/v1/blocks
 *   DELETE /api/v1/blocks/:blockedUserId
 *   GET    /api/v1/blocks/mine
 *
 * Identity: no method accepts a `reporterId`/`blockerId`. Authentication
 * headers are attached by the API client's `AuthHeadersProvider`
 * (Phase 3.14) and the backend derives identity from them.
 *
 * `createBlock`'s backend endpoint responds 201 (new block) or 200
 * (idempotent no-op / reactivation) — both cases are a plain success from
 * the generic client's perspective (see `api/client.ts`), so this layer
 * returns the resulting `Block` either way without exposing the status
 * code, consistent with every other method in this app's API layer.
 */
import type { ApiClient } from '../api/client';
import type { ActiveBlockDto, BlockDto, ReportDto } from './api.types';
import { mapActiveBlock, mapBlock, mapReport } from './mappers';
import type { ActiveBlock, Block, Report, ReportReasonValue } from './types';

/** Input for `POST /api/v1/reports`. */
export interface CreateReportInput {
  reportedUserId: string;
  reason: ReportReasonValue;
  /** Optional free-text detail (backend caps this at 2000 characters). */
  detail?: string;
  /** Optional ride this report relates to. */
  rideId?: string;
}

/** Input for `POST /api/v1/blocks`. */
export interface CreateBlockInput {
  blockedUserId: string;
}

/** Input for `DELETE /api/v1/blocks/:blockedUserId`. */
export interface RemoveBlockInput {
  blockedUserId: string;
}

export interface SafetyApi {
  /** POST /api/v1/reports — file a report against a ride co-participant. */
  createReport(input: CreateReportInput): Promise<Report>;

  /** GET /api/v1/reports/mine — the authenticated user's own filed reports. */
  listMyReports(): Promise<Report[]>;

  /**
   * POST /api/v1/blocks — block a ride co-participant. Idempotent on the
   * backend (already-active block or a previously-unblocked pair both
   * succeed without erroring).
   */
  createBlock(input: CreateBlockInput): Promise<Block>;

  /**
   * DELETE /api/v1/blocks/:blockedUserId — unblock (soft delete on the
   * backend). Idempotent: unblocking a non-existent or already-inactive
   * block still succeeds.
   */
  removeBlock(input: RemoveBlockInput): Promise<void>;

  /** GET /api/v1/blocks/mine — the authenticated user's currently-active
   * blocks. */
  listMyBlocks(): Promise<ActiveBlock[]>;
}

const REPORTS_PATH = '/reports';
const REPORTS_MINE_PATH = `${REPORTS_PATH}/mine`;
const BLOCKS_PATH = '/blocks';
const BLOCKS_MINE_PATH = `${BLOCKS_PATH}/mine`;

function blockPath(blockedUserId: string): string {
  return `${BLOCKS_PATH}/${encodeURIComponent(blockedUserId)}`;
}

/** Builds the typed safety API over the generic client. */
export function createSafetyApi(client: ApiClient): SafetyApi {
  return {
    async createReport(input) {
      const report = await client.request<ReportDto>(REPORTS_PATH, {
        method: 'POST',
        body: {
          reportedUserId: input.reportedUserId,
          reason: input.reason,
          detail: input.detail,
          rideId: input.rideId,
        },
      });
      return mapReport(report);
    },

    async listMyReports() {
      const reports = await client.request<ReportDto[]>(REPORTS_MINE_PATH);
      return reports.map(mapReport);
    },

    async createBlock(input) {
      const block = await client.request<BlockDto>(BLOCKS_PATH, {
        method: 'POST',
        body: { blockedUserId: input.blockedUserId },
      });
      return mapBlock(block);
    },

    async removeBlock(input) {
      await client.request<undefined>(blockPath(input.blockedUserId), {
        method: 'DELETE',
      });
    },

    async listMyBlocks() {
      const blocks = await client.request<ActiveBlockDto[]>(BLOCKS_MINE_PATH);
      return blocks.map(mapActiveBlock);
    },
  };
}
