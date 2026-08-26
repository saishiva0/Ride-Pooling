/**
 * Ride-co-participant eligibility check (Phase 3.24 — Reporting & Blocking).
 *
 * DECIDED (Product owner decision, 2026-08-21, `docs/planning/phases/phase-3-24.md`
 * §9/§11/§13): a report or block may only be created between two users who
 * have, at some point, both held creator-or-participant status on the SAME
 * ride — i.e. for that ride, each user is either `Ride.creatorId` or a
 * `RideParticipant.userId` row (any status — the decision text does not
 * qualify "participant" by `RideParticipant.status`). A pending/rejected
 * `RideRequest` with no `RideParticipant` row does NOT count (proposed
 * default per §9).
 *
 * This spans two tables per side and cannot be expressed as a single-column
 * database FK or CHECK constraint, so it is enforced here at the application
 * layer — the implied FK/check that `create-report.ts`/`create-block.ts`
 * consult before writing a `Report`/`Block` row.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Whether `userA` and `userB` have ever shared a ride as creator/participant
 * (in either combination). Symmetric — order does not matter.
 */
export async function areRideCoParticipants(
  client: Prisma.TransactionClient | PrismaClient,
  userA: string,
  userB: string,
): Promise<boolean> {
  const ride = await client.ride.findFirst({
    where: {
      AND: [
        {
          OR: [
            { creatorId: userA },
            { participants: { some: { userId: userA } } },
          ],
        },
        {
          OR: [
            { creatorId: userB },
            { participants: { some: { userId: userB } } },
          ],
        },
      ],
    },
    select: { id: true },
  });
  return ride !== null;
}
