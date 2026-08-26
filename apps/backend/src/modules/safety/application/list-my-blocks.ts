/**
 * "My blocks" listing use case (Phase 3.24 — Reporting & Blocking, §10
 * `GET /blocks/mine`). Owner-scoped and ACTIVE-only (`unblockedAt IS NULL`)
 * — a resolved/inactive block never appears here.
 */
import { prisma } from '../../../lib/prisma.js';
import {
  listActiveBlocksForUser,
  type ActiveBlockRow,
} from '../infrastructure/block.repository.js';

/** An active block, shaped for application-layer consumers. */
export interface MyActiveBlock {
  id: string;
  blockedUser: { id: string; name: string };
  createdAt: Date;
}

export interface ListMyBlocksDependencies {
  listActiveBlocksForUser: (blockerId: string) => Promise<ActiveBlockRow[]>;
}

function defaultDependencies(): ListMyBlocksDependencies {
  return {
    listActiveBlocksForUser: (blockerId) =>
      listActiveBlocksForUser(prisma, blockerId),
  };
}

function toMyActiveBlock(record: ActiveBlockRow): MyActiveBlock {
  return {
    id: record.id,
    blockedUser: record.blocked,
    createdAt: record.createdAt,
  };
}

/** Lists `blockerId`'s currently-active blocks, newest first. */
export async function listMyBlocks(
  blockerId: string,
  deps: Partial<ListMyBlocksDependencies> = {},
): Promise<MyActiveBlock[]> {
  const { listActiveBlocksForUser: list } = {
    ...defaultDependencies(),
    ...deps,
  };
  const rows = await list(blockerId);
  return rows.map(toMyActiveBlock);
}
