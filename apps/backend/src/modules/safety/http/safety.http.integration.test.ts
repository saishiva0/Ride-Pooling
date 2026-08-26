/**
 * Phase 3.24 HTTP integration tests for the Reporting & Blocking API.
 *
 * Runs against the REAL Express application (supertest) and the REAL
 * PostgreSQL database, using the TEST authenticator (`x-test-user-id`
 * header). Covers: report/block creation (201/200 happy paths), the
 * ride-co-participant scope check (403, DECIDED), self-report/self-block
 * (400), unknown target (404), unauthenticated access (401), client-
 * supplied actor id ignored, the rolling-24h report rate limit (5/24h,
 * DECIDED), unblock soft-delete + idempotent re-block reactivation, owner-
 * scoped listings, and the privacy/silence requirements (§12/§16 —
 * DECIDED): no report/block fact is ever disclosed to the counterparty, and
 * no notification/push/realtime record is ever created naming the
 * reporter/blocker.
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PricingType, ReportReason, RideStatus } from '@prisma/client';
import { createApp } from '../../../app.js';
import { loadConfig } from '../../../config/index.js';
import { createLogger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { createTestAuthenticator } from '../../auth/http/auth.middleware.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
const app = createApp({
  config,
  logger: createLogger({ level: 'silent', pretty: false }),
  authenticator: createTestAuthenticator(),
});

const RUN_ID = `safetyhttp_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let seq = 0;
function unique(label: string): string {
  seq += 1;
  return `${RUN_ID}_${label}_${seq}`;
}

const cleanup = {
  reportIds: [] as string[],
  participantIds: [] as string[],
  requestIds: [] as string[],
  rideIds: [] as string[],
  locationIds: [] as string[],
  userIds: [] as string[],
};

afterAll(async () => {
  await prisma.report.deleteMany({ where: { id: { in: cleanup.reportIds } } });
  await prisma.block.deleteMany({
    where: {
      OR: [
        { blockerId: { in: cleanup.userIds } },
        { blockedId: { in: cleanup.userIds } },
      ],
    },
  });
  // Deleted by rideId (not just the tracked fixture ids): the rate-limit
  // test creates a REAL ride request through the actual HTTP endpoint,
  // whose id this file never tracks individually.
  await prisma.rideParticipant.deleteMany({
    where: { rideId: { in: cleanup.rideIds } },
  });
  await prisma.rideRequest.deleteMany({
    where: { rideId: { in: cleanup.rideIds } },
  });
  await prisma.ride.deleteMany({ where: { id: { in: cleanup.rideIds } } });
  await prisma.location.deleteMany({
    where: { id: { in: cleanup.locationIds } },
  });
  await prisma.notification.deleteMany({
    where: { userId: { in: cleanup.userIds } },
  });
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

// A coordinate deliberately far from the shared Bengaluru `BASE` point used
// by the ride module's discovery/matching integration tests — this file
// creates PUBLISHED rides too and must never pollute those discovery-radius
// tests when run concurrently against the same real database.
async function createLocation() {
  const location = await prisma.location.create({
    data: { latitude: 3, longitude: 3, label: unique('loc') },
  });
  cleanup.locationIds.push(location.id);
  return location;
}

/** Creates a ride creator + a CONFIRMED co-participant on a shared ride. */
async function createCoParticipantPair(label: string) {
  const creator = await createUser(`${label}-creator`);
  const participant = await createUser(`${label}-participant`);
  const pickup = await createLocation();
  const destination = await createLocation();
  const ride = await prisma.ride.create({
    data: {
      creatorId: creator.id,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
      departureDateTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      totalSeats: 3,
      vehicleType: unique('vehicle'),
      pricingType: PricingType.STANDARD,
      pricePerKm: 4,
      status: RideStatus.PUBLISHED,
    },
  });
  cleanup.rideIds.push(ride.id);

  const rideRequest = await prisma.rideRequest.create({
    data: {
      rideId: ride.id,
      userId: participant.id,
      requestedSeats: 1,
      status: 'ACCEPTED',
      resolvedAt: new Date(),
    },
  });
  cleanup.requestIds.push(rideRequest.id);
  const rideParticipant = await prisma.rideParticipant.create({
    data: {
      rideId: ride.id,
      userId: participant.id,
      requestId: rideRequest.id,
      seatsAllocated: 1,
      status: 'CONFIRMED',
    },
  });
  cleanup.participantIds.push(rideParticipant.id);

  return { creator, participant, ride };
}

const authHeader = (userId: string) => ({ 'x-test-user-id': userId });

describe('POST /api/v1/reports', () => {
  it('creates a report against a ride co-participant (201, { data })', async () => {
    const { creator, participant } = await createCoParticipantPair('create');

    const res = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(creator.id))
      .send({
        reportedUserId: participant.id,
        reason: ReportReason.HARASSMENT,
        detail: 'was rude at pickup',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.reportedUserId).toBe(participant.id);
    expect(res.body.data.reason).toBe(ReportReason.HARASSMENT);
    if (res.body.data.id) cleanup.reportIds.push(res.body.data.id);
  });

  it('ignores a client-supplied reporterId — identity comes from auth only', async () => {
    const { creator, participant } = await createCoParticipantPair('spoof');
    const stranger = await createUser('spoof-stranger');

    const res = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(creator.id))
      .send({
        reportedUserId: participant.id,
        reason: ReportReason.OTHER,
        reporterId: stranger.id,
      });

    expect(res.status).toBe(201);
    const stored = await prisma.report.findUnique({
      where: { id: res.body.data.id },
    });
    cleanup.reportIds.push(res.body.data.id);
    expect(stored?.reporterId).toBe(creator.id);
  });

  it('rejects self-report with 400', async () => {
    const { creator } = await createCoParticipantPair('self');

    const res = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(creator.id))
      .send({ reportedUserId: creator.id, reason: ReportReason.OTHER });

    expect(res.status).toBe(400);
  });

  it('rejects an invalid reason enum value with 400', async () => {
    const { creator, participant } =
      await createCoParticipantPair('bad-reason');

    const res = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(creator.id))
      .send({ reportedUserId: participant.id, reason: 'NOT_A_REAL_REASON' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for a nonexistent target', async () => {
    const { creator } = await createCoParticipantPair('missing-target');

    const res = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(creator.id))
      .send({
        reportedUserId: unique('nonexistent-user'),
        reason: ReportReason.OTHER,
      });

    expect(res.status).toBe(404);
  });

  it('returns 403 when caller and target are not ride co-participants (DECIDED)', async () => {
    const userA = await createUser('scope-a');
    const userB = await createUser('scope-b');

    const res = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(userA.id))
      .send({ reportedUserId: userB.id, reason: ReportReason.OTHER });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
  });

  it('requires authentication (401)', async () => {
    const res = await request(app)
      .post('/api/v1/reports')
      .send({ reportedUserId: unique('x'), reason: ReportReason.OTHER });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/reports — rate limit (§11, DECIDED: 5 per rolling 24h)', () => {
  it('allows the 5th report and rejects the 6th with 429, without touching an unrelated ride operation', async () => {
    const { creator, participant } =
      await createCoParticipantPair('rate-limit');

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post('/api/v1/reports')
        .set(authHeader(creator.id))
        .send({ reportedUserId: participant.id, reason: ReportReason.OTHER });
      expect(res.status).toBe(201);
      cleanup.reportIds.push(res.body.data.id);
    }

    const sixth = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(creator.id))
      .send({ reportedUserId: participant.id, reason: ReportReason.OTHER });
    expect(sixth.status).toBe(429);

    // §14: a report failure must never roll back or block an unrelated
    // in-flight ride/request operation. Prove it with a genuinely unrelated
    // ride request between two different users, created right after the
    // 429.
    const unrelated = await createCoParticipantPair('rate-limit-unrelated');
    const stranger = await createUser('rate-limit-unrelated-requester');
    const requestRes = await request(app)
      .post(`/api/v1/rides/${unrelated.ride.id}/requests`)
      .set(authHeader(stranger.id))
      .send({});
    expect(requestRes.status).toBe(201);
  });
});

describe('GET /api/v1/reports/mine', () => {
  it('lists only the authenticated user own filed reports', async () => {
    const { creator, participant } = await createCoParticipantPair('list');
    const other = await createCoParticipantPair('list-other');

    const mine = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(creator.id))
      .send({ reportedUserId: participant.id, reason: ReportReason.OTHER });
    cleanup.reportIds.push(mine.body.data.id);
    const theirs = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(other.creator.id))
      .send({
        reportedUserId: other.participant.id,
        reason: ReportReason.OTHER,
      });
    cleanup.reportIds.push(theirs.body.data.id);

    const res = await request(app)
      .get('/api/v1/reports/mine')
      .set(authHeader(creator.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(mine.body.data.id);
  });
});

describe('POST /api/v1/blocks', () => {
  it('creates a block against a ride co-participant (201, { data })', async () => {
    const { creator, participant } =
      await createCoParticipantPair('block-create');

    const res = await request(app)
      .post('/api/v1/blocks')
      .set(authHeader(creator.id))
      .send({ blockedUserId: participant.id });

    expect(res.status).toBe(201);
    expect(res.body.data.blockedUserId).toBe(participant.id);
    expect(res.body.data.unblockedAt).toBeNull();
  });

  it('is idempotent: blocking an already-actively-blocked user is a 200 no-op', async () => {
    const { creator, participant } = await createCoParticipantPair('block-dup');

    const first = await request(app)
      .post('/api/v1/blocks')
      .set(authHeader(creator.id))
      .send({ blockedUserId: participant.id });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/blocks')
      .set(authHeader(creator.id))
      .send({ blockedUserId: participant.id });
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it('ignores a client-supplied blockerId — identity comes from auth only', async () => {
    const { creator, participant } =
      await createCoParticipantPair('block-spoof');
    const stranger = await createUser('block-spoof-stranger');

    const res = await request(app)
      .post('/api/v1/blocks')
      .set(authHeader(creator.id))
      .send({ blockedUserId: participant.id, blockerId: stranger.id });

    expect(res.status).toBe(201);
    const stored = await prisma.block.findUnique({
      where: {
        blockerId_blockedId: {
          blockerId: creator.id,
          blockedId: participant.id,
        },
      },
    });
    expect(stored).not.toBeNull();
  });

  it('rejects self-block with 400', async () => {
    const { creator } = await createCoParticipantPair('block-self');

    const res = await request(app)
      .post('/api/v1/blocks')
      .set(authHeader(creator.id))
      .send({ blockedUserId: creator.id });

    expect(res.status).toBe(400);
  });

  it('returns 404 for a nonexistent target', async () => {
    const { creator } = await createCoParticipantPair('block-missing');

    const res = await request(app)
      .post('/api/v1/blocks')
      .set(authHeader(creator.id))
      .send({ blockedUserId: unique('nonexistent-user') });

    expect(res.status).toBe(404);
  });

  it('returns 403 when caller and target are not ride co-participants (DECIDED)', async () => {
    const userA = await createUser('block-scope-a');
    const userB = await createUser('block-scope-b');

    const res = await request(app)
      .post('/api/v1/blocks')
      .set(authHeader(userA.id))
      .send({ blockedUserId: userB.id });

    expect(res.status).toBe(403);
  });

  it('requires authentication (401)', async () => {
    const res = await request(app)
      .post('/api/v1/blocks')
      .send({ blockedUserId: unique('x') });

    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/v1/blocks/:blockedUserId — unblock (§9/§13, DECIDED soft delete)', () => {
  it('soft-deletes the block: 204, row retained with unblockedAt set', async () => {
    const { creator, participant } = await createCoParticipantPair('unblock');
    await request(app)
      .post('/api/v1/blocks')
      .set(authHeader(creator.id))
      .send({ blockedUserId: participant.id });

    const res = await request(app)
      .delete(`/api/v1/blocks/${participant.id}`)
      .set(authHeader(creator.id));
    expect(res.status).toBe(204);

    const stored = await prisma.block.findUnique({
      where: {
        blockerId_blockedId: {
          blockerId: creator.id,
          blockedId: participant.id,
        },
      },
    });
    expect(stored).not.toBeNull();
    expect(stored?.unblockedAt).not.toBeNull();
  });

  it('is idempotent (204) for a pair with no active block', async () => {
    const { creator, participant } =
      await createCoParticipantPair('unblock-none');

    const res = await request(app)
      .delete(`/api/v1/blocks/${participant.id}`)
      .set(authHeader(creator.id));
    expect(res.status).toBe(204);
  });

  it('reactivates the SAME row on re-block after an unblock (§13, DECIDED)', async () => {
    const { creator, participant } = await createCoParticipantPair('reblock');
    const first = await request(app)
      .post('/api/v1/blocks')
      .set(authHeader(creator.id))
      .send({ blockedUserId: participant.id });
    await request(app)
      .delete(`/api/v1/blocks/${participant.id}`)
      .set(authHeader(creator.id));

    const reblocked = await request(app)
      .post('/api/v1/blocks')
      .set(authHeader(creator.id))
      .send({ blockedUserId: participant.id });

    expect(reblocked.status).toBe(200);
    expect(reblocked.body.data.id).toBe(first.body.data.id);
    expect(reblocked.body.data.unblockedAt).toBeNull();

    const rowCount = await prisma.block.count({
      where: { blockerId: creator.id, blockedId: participant.id },
    });
    expect(rowCount).toBe(1);
  });

  it('requires authentication (401)', async () => {
    const res = await request(app).delete(`/api/v1/blocks/${unique('x')}`);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/blocks/mine — owner-scoped, active-only (§10)', () => {
  it("lists the caller's active blocks and never the blocks made against them (§12 privacy)", async () => {
    const { creator, participant } =
      await createCoParticipantPair('list-blocks');
    await request(app)
      .post('/api/v1/blocks')
      .set(authHeader(creator.id))
      .send({ blockedUserId: participant.id });

    const mine = await request(app)
      .get('/api/v1/blocks/mine')
      .set(authHeader(creator.id));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].blockedUserId).toBe(participant.id);

    // The blocked user has no visibility into being blocked — no endpoint
    // ever discloses this to them (§12/§16, DECIDED, fully silent).
    const theirs = await request(app)
      .get('/api/v1/blocks/mine')
      .set(authHeader(participant.id));
    expect(theirs.status).toBe(200);
    expect(theirs.body.data).toHaveLength(0);
  });

  it('excludes a resolved (unblocked) pair', async () => {
    const { creator, participant } = await createCoParticipantPair(
      'list-blocks-resolved',
    );
    await request(app)
      .post('/api/v1/blocks')
      .set(authHeader(creator.id))
      .send({ blockedUserId: participant.id });
    await request(app)
      .delete(`/api/v1/blocks/${participant.id}`)
      .set(authHeader(creator.id));

    const res = await request(app)
      .get('/api/v1/blocks/mine')
      .set(authHeader(creator.id));
    expect(res.body.data).toHaveLength(0);
  });
});

describe('Silence requirements (§16, DECIDED — no notification/push/realtime for either party)', () => {
  it('creates no Notification row for the reported user', async () => {
    const { creator, participant } =
      await createCoParticipantPair('silent-report');
    const before = await prisma.notification.count({
      where: { userId: participant.id },
    });

    const res = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(creator.id))
      .send({ reportedUserId: participant.id, reason: ReportReason.OTHER });
    cleanup.reportIds.push(res.body.data.id);

    const after = await prisma.notification.count({
      where: { userId: participant.id },
    });
    expect(after).toBe(before);
  });

  it('creates no Notification row for the blocked user', async () => {
    const { creator, participant } =
      await createCoParticipantPair('silent-block');
    const before = await prisma.notification.count({
      where: { userId: participant.id },
    });

    await request(app)
      .post('/api/v1/blocks')
      .set(authHeader(creator.id))
      .send({ blockedUserId: participant.id });

    const after = await prisma.notification.count({
      where: { userId: participant.id },
    });
    expect(after).toBe(before);
  });
});
