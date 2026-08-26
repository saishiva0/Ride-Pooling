/**
 * Cross-module block read (Phase 3.24 — Reporting & Blocking, §7/§13).
 *
 * The ONLY seam through which the `ride` module consults blocking: "is X
 * actively blocked with Y, in either direction?" Read-only, no side
 * effects. This is a same-direction concern (Safety & Trust informing Ride
 * Engine queries), not the reverse — Ride Engine never writes to `Block`.
 *
 * Consulted by ride discovery (`discover-rides.ts`) and ride-request
 * creation (`create-ride-request.ts`) to satisfy the DECIDED requirement
 * (Product owner decision, 2026-08-21) that a block affects future
 * discovery/matching and new requests, without touching any existing
 * CONFIRMED participation.
 */
import { prisma } from '../../../lib/prisma.js';
import { findActiveBlockBetween } from '../infrastructure/block.repository.js';

export interface BlockCheckDependencies {
  findActiveBlockBetween: (userA: string, userB: string) => Promise<boolean>;
}

function defaultDependencies(): BlockCheckDependencies {
  return {
    findActiveBlockBetween: (userA, userB) =>
      findActiveBlockBetween(prisma, userA, userB),
  };
}

/**
 * Whether `userA` and `userB` currently have an active block between them
 * (in either direction). Two identical ids are never considered blocked.
 */
export async function isBlockedPair(
  userA: string,
  userB: string,
  deps: Partial<BlockCheckDependencies> = {},
): Promise<boolean> {
  const { findActiveBlockBetween: checkActiveBlock } = {
    ...defaultDependencies(),
    ...deps,
  };
  if (userA === userB) {
    return false;
  }
  return checkActiveBlock(userA, userB);
}
