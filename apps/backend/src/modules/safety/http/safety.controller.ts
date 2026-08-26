/**
 * Safety HTTP controllers (Phase 3.24 — Reporting & Blocking).
 *
 * Thin by construction: read the request, read the authenticated identity,
 * parse HTTP input with Zod, call ONE existing application service, and
 * envelope the result. The actor id ALWAYS comes from the authentication
 * boundary (`getAuthenticatedUser`) — a client-supplied
 * `reporterId`/`blockerId` in the body is never read, mirroring the tested
 * behavior in Phase 3.23's device-token endpoints.
 */
import type { Request, Response } from 'express';
import { getAuthenticatedUser } from '../../auth/http/auth.middleware.js';
import { parseRequest } from '../../api/parse.js';
import { sendData } from '../../api/response.js';
import {
  createReport,
  type CreatedReport,
} from '../application/create-report.js';
import { listMyReports } from '../application/list-my-reports.js';
import { createBlock, type CreatedBlock } from '../application/create-block.js';
import { removeBlock } from '../application/remove-block.js';
import { listMyBlocks } from '../application/list-my-blocks.js';
import {
  blockedUserIdPathSchema,
  createBlockSchema,
  createReportSchema,
} from './safety.schemas.js';

function serializeReport(report: CreatedReport) {
  return {
    id: report.id,
    reportedUserId: report.reportedId,
    rideId: report.rideId,
    reason: report.reason,
    detail: report.detail,
    createdAt: report.createdAt.toISOString(),
  };
}

function serializeBlock(block: CreatedBlock) {
  return {
    id: block.id,
    blockedUserId: block.blockedId,
    createdAt: block.createdAt.toISOString(),
    unblockedAt: block.unblockedAt ? block.unblockedAt.toISOString() : null,
  };
}

/** POST /api/v1/reports — the authenticated user is the reporter. */
export async function createReportHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const body = parseRequest(createReportSchema, req.body);

  const report = await createReport({
    reporterId: identity.userId,
    reportedId: body.reportedUserId,
    reason: body.reason,
    detail: body.detail,
    rideId: body.rideId,
  });
  sendData(res, 201, serializeReport(report));
}

/** GET /api/v1/reports/mine — the authenticated user's own filed reports. */
export async function listMyReportsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const reports = await listMyReports(identity.userId);
  sendData(res, 200, reports.map(serializeReport));
}

/** POST /api/v1/blocks — the authenticated user is the blocker. */
export async function createBlockHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const body = parseRequest(createBlockSchema, req.body);

  const { block, created } = await createBlock({
    blockerId: identity.userId,
    blockedId: body.blockedUserId,
  });
  sendData(res, created ? 201 : 200, serializeBlock(block));
}

/**
 * DELETE /api/v1/blocks/:blockedUserId — unblock (soft delete). Always
 * 204, even when no active block existed (§10, §13 — idempotent).
 */
export async function removeBlockHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const { blockedUserId } = parseRequest(blockedUserIdPathSchema, req.params);

  await removeBlock({ blockerId: identity.userId, blockedId: blockedUserId });
  res.status(204).send();
}

/** GET /api/v1/blocks/mine — the authenticated user's currently-active blocks. */
export async function listMyBlocksHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const blocks = await listMyBlocks(identity.userId);
  sendData(
    res,
    200,
    blocks.map((b) => ({
      blockedUserId: b.blockedUser.id,
      blockedUserName: b.blockedUser.name,
      createdAt: b.createdAt.toISOString(),
    })),
  );
}
