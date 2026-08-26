/**
 * Unit tests for the Phase 3.17 creator lifecycle use cases — publish, start,
 * complete.
 *
 * No PostgreSQL required: the `runTransaction` persistence port is faked.
 * Covers input validation, missing ride, creator authorization, legal state
 * transitions, illegal-state rejection (no duplicate history), and error
 * translation (P2025/P2003 → NotFoundError, unexpected → InternalError).
 *
 * Notification behavior: per the canonical Phase 3.17 spec, publish/start/
 * complete create NO notification — the existing six-event mapping has no
 * RIDE_PUBLISHED / RIDE_STARTED / RIDE_COMPLETED drafts. These tests assert
 * that no notification is attempted and no realtime event is published.
 */
import { describe, expect, it, vi } from 'vitest';
import { RideStatus } from '@prisma/client';
import {
  AuthorizationError,
  BusinessRuleError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import { publishRide, RIDE_PUBLISHED_REASON } from './publish-ride.js';
import { startRide, RIDE_STARTED_REASON } from './start-ride.js';
import { completeRide, RIDE_COMPLETED_REASON } from './complete-ride.js';
import type {
  RideLifecycleDependencies,
  RideLifecyclePersistence,
} from './ride-lifecycle.js';
import type { LockedRideLifecycleRow } from '../infrastructure/ride.repository.js';

function fakePersistence(
  overrides: Partial<RideLifecyclePersistence> = {},
): RideLifecyclePersistence {
  return {
    lockRide: vi.fn(),
    updateRideStatus: vi.fn(),
    createStatusHistory: vi.fn(),
    findConfirmedParticipantIds: vi.fn(),
    createNotification: vi.fn(),
    classifyError: vi.fn(() => null),
    ...overrides,
  };
}

const creatorId = 'creator-1';
const rideId = 'ride-1';

function lockedRide(
  overrides: Partial<LockedRideLifecycleRow> = {},
): LockedRideLifecycleRow {
  return {
    id: rideId,
    creatorId,
    status: RideStatus.DRAFT,
    departureDateTime: new Date('2026-08-20T10:00:00.000Z'),
    ...overrides,
  };
}

function happyPersistence(status: RideStatus): RideLifecyclePersistence {
  return fakePersistence({
    lockRide: vi.fn().mockResolvedValue(lockedRide({ status })),
    updateRideStatus: vi.fn().mockResolvedValue({ id: rideId, status }),
    createStatusHistory: vi.fn().mockResolvedValue({ id: 'history-1' }),
  });
}

function run(
  useCase: (
    input: { rideId: string; actorId: string },
    deps?: {
      runTransaction: RideLifecycleDependencies['runTransaction'];
    },
  ) => Promise<{ rideId: string; status: RideStatus }>,
  persistence: RideLifecyclePersistence,
  input: { rideId: string; actorId: string },
): Promise<{ rideId: string; status: RideStatus }> {
  return useCase(input, {
    runTransaction: async (work) => work(persistence),
  });
}

describe('publishRide', () => {
  it('publishes a DRAFT ride: status, history, and no notification/realtime event', async () => {
    const persistence = happyPersistence(RideStatus.DRAFT);
    const publishEvents = vi.fn();

    const result = await publishRide(
      { rideId, actorId: creatorId },
      {
        runTransaction: async (work) => work(persistence),
        publishEvents,
      },
    );

    expect(result).toEqual({
      rideId,
      status: RideStatus.PUBLISHED,
      publishedAt: expect.any(Date),
    });
    expect(persistence.updateRideStatus).toHaveBeenCalledWith({
      rideId,
      status: RideStatus.PUBLISHED,
    });
    expect(persistence.createStatusHistory).toHaveBeenCalledWith({
      rideId,
      fromStatus: RideStatus.DRAFT,
      toStatus: RideStatus.PUBLISHED,
      changedByUserId: creatorId,
      reason: RIDE_PUBLISHED_REASON,
    });
    // Canonical Phase 3.17: publish creates no notification and emits no event.
    expect(persistence.findConfirmedParticipantIds).not.toHaveBeenCalled();
    expect(persistence.createNotification).not.toHaveBeenCalled();
    expect(publishEvents).toHaveBeenCalledWith([]);
  });

  it('rejects publishing a non-DRAFT ride without any writes', async () => {
    for (const status of [
      RideStatus.PUBLISHED,
      RideStatus.CONFIRMED,
      RideStatus.IN_PROGRESS,
      RideStatus.COMPLETED,
      RideStatus.CANCELLED,
      RideStatus.EXPIRED,
    ]) {
      const persistence = happyPersistence(status);
      const promise = run(publishRide, persistence, {
        rideId,
        actorId: creatorId,
      });
      await expect(promise).rejects.toBeInstanceOf(BusinessRuleError);
      await expect(promise).rejects.toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        statusCode: 422,
        details: { rideId, status },
      });
      expect(persistence.updateRideStatus).not.toHaveBeenCalled();
      expect(persistence.createStatusHistory).not.toHaveBeenCalled();
    }
  });

  it('rejects a non-creator actor with no writes', async () => {
    const persistence = happyPersistence(RideStatus.DRAFT);
    const promise = run(publishRide, persistence, {
      rideId,
      actorId: 'stranger',
    });
    await expect(promise).rejects.toBeInstanceOf(AuthorizationError);
    await expect(promise).rejects.toMatchObject({
      code: 'AUTHORIZATION_ERROR',
      statusCode: 403,
    });
    expect(persistence.updateRideStatus).not.toHaveBeenCalled();
    expect(persistence.createStatusHistory).not.toHaveBeenCalled();
  });

  it('rejects a missing ride without any writes', async () => {
    const persistence = fakePersistence({
      lockRide: vi.fn().mockResolvedValue(null),
      updateRideStatus: vi.fn(),
      createStatusHistory: vi.fn(),
    });
    const promise = run(publishRide, persistence, {
      rideId,
      actorId: creatorId,
    });
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    await expect(promise).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
    expect(persistence.updateRideStatus).not.toHaveBeenCalled();
    expect(persistence.createStatusHistory).not.toHaveBeenCalled();
  });

  it('rejects malformed input before touching the transaction', async () => {
    const runTransaction = vi.fn();
    const deps = {
      runTransaction:
        runTransaction as unknown as RideLifecycleDependencies['runTransaction'],
    };
    await expect(
      publishRide({ rideId: '', actorId: creatorId }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      publishRide({ rideId, actorId: '   ' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('translates a P2025 write failure into a NotFoundError', async () => {
    const persistence = happyPersistence(RideStatus.DRAFT);
    persistence.updateRideStatus = vi
      .fn()
      .mockRejectedValue(new Error('P2025'));
    persistence.classifyError = vi.fn(
      (_err: unknown): 'not_found' | 'foreign_key' | null => 'not_found',
    );
    const promise = run(publishRide, persistence, {
      rideId,
      actorId: creatorId,
    });
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    await expect(promise).rejects.not.toThrow('P2025');
  });

  it('wraps an unexpected persistence failure without leaking it', async () => {
    const persistence = happyPersistence(RideStatus.DRAFT);
    persistence.updateRideStatus = vi
      .fn()
      .mockRejectedValue(new Error('connection reset by peer'));
    const promise = run(publishRide, persistence, {
      rideId,
      actorId: creatorId,
    });
    await expect(promise).rejects.toBeInstanceOf(InternalError);
    await expect(promise).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    });
    await expect(promise).rejects.not.toThrow('connection reset by peer');
  });
});

describe('startRide', () => {
  it.each([RideStatus.PUBLISHED, RideStatus.CONFIRMED])(
    'starts a %s ride: status, history, and no notification/realtime event',
    async (status) => {
      const persistence = happyPersistence(status);
      const publishEvents = vi.fn();

      const result = await startRide(
        { rideId, actorId: creatorId },
        {
          runTransaction: async (work) => work(persistence),
          publishEvents,
        },
      );

      expect(result).toEqual({
        rideId,
        status: RideStatus.IN_PROGRESS,
        startedAt: expect.any(Date),
      });
      expect(persistence.updateRideStatus).toHaveBeenCalledWith({
        rideId,
        status: RideStatus.IN_PROGRESS,
      });
      expect(persistence.createStatusHistory).toHaveBeenCalledWith({
        rideId,
        fromStatus: status,
        toStatus: RideStatus.IN_PROGRESS,
        changedByUserId: creatorId,
        reason: RIDE_STARTED_REASON,
      });
      expect(persistence.createNotification).not.toHaveBeenCalled();
      expect(publishEvents).toHaveBeenCalledWith([]);
    },
  );

  it('rejects starting a non-startable ride without any writes', async () => {
    for (const status of [
      RideStatus.DRAFT,
      RideStatus.IN_PROGRESS,
      RideStatus.COMPLETED,
      RideStatus.CANCELLED,
      RideStatus.EXPIRED,
    ]) {
      const persistence = happyPersistence(status);
      const promise = run(startRide, persistence, {
        rideId,
        actorId: creatorId,
      });
      await expect(promise).rejects.toBeInstanceOf(BusinessRuleError);
      await expect(promise).rejects.toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        details: { rideId, status },
      });
      expect(persistence.updateRideStatus).not.toHaveBeenCalled();
      expect(persistence.createStatusHistory).not.toHaveBeenCalled();
    }
  });

  it('rejects a non-creator actor with no writes', async () => {
    const persistence = happyPersistence(RideStatus.PUBLISHED);
    const promise = run(startRide, persistence, {
      rideId,
      actorId: 'stranger',
    });
    await expect(promise).rejects.toBeInstanceOf(AuthorizationError);
    expect(persistence.updateRideStatus).not.toHaveBeenCalled();
    expect(persistence.createStatusHistory).not.toHaveBeenCalled();
  });

  it('rejects a missing ride without any writes', async () => {
    const persistence = fakePersistence({
      lockRide: vi.fn().mockResolvedValue(null),
      updateRideStatus: vi.fn(),
      createStatusHistory: vi.fn(),
    });
    const promise = run(startRide, persistence, { rideId, actorId: creatorId });
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    expect(persistence.updateRideStatus).not.toHaveBeenCalled();
    expect(persistence.createStatusHistory).not.toHaveBeenCalled();
  });
});

describe('completeRide', () => {
  it('completes an IN_PROGRESS ride: status, history, and no notification/realtime event', async () => {
    const persistence = happyPersistence(RideStatus.IN_PROGRESS);
    const publishEvents = vi.fn();

    const result = await completeRide(
      { rideId, actorId: creatorId },
      {
        runTransaction: async (work) => work(persistence),
        publishEvents,
      },
    );

    expect(result).toEqual({
      rideId,
      status: RideStatus.COMPLETED,
      completedAt: expect.any(Date),
    });
    expect(persistence.updateRideStatus).toHaveBeenCalledWith({
      rideId,
      status: RideStatus.COMPLETED,
    });
    expect(persistence.createStatusHistory).toHaveBeenCalledWith({
      rideId,
      fromStatus: RideStatus.IN_PROGRESS,
      toStatus: RideStatus.COMPLETED,
      changedByUserId: creatorId,
      reason: RIDE_COMPLETED_REASON,
    });
    expect(persistence.createNotification).not.toHaveBeenCalled();
    expect(publishEvents).toHaveBeenCalledWith([]);
  });

  it('rejects completing a non-completable ride without any writes', async () => {
    for (const status of [
      RideStatus.DRAFT,
      RideStatus.PUBLISHED,
      RideStatus.CONFIRMED,
      RideStatus.COMPLETED,
      RideStatus.CANCELLED,
      RideStatus.EXPIRED,
    ]) {
      const persistence = happyPersistence(status);
      const promise = run(completeRide, persistence, {
        rideId,
        actorId: creatorId,
      });
      await expect(promise).rejects.toBeInstanceOf(BusinessRuleError);
      await expect(promise).rejects.toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        details: { rideId, status },
      });
      expect(persistence.updateRideStatus).not.toHaveBeenCalled();
      expect(persistence.createStatusHistory).not.toHaveBeenCalled();
    }
  });

  it('rejects a non-creator actor with no writes', async () => {
    const persistence = happyPersistence(RideStatus.IN_PROGRESS);
    const promise = run(completeRide, persistence, {
      rideId,
      actorId: 'stranger',
    });
    await expect(promise).rejects.toBeInstanceOf(AuthorizationError);
    expect(persistence.updateRideStatus).not.toHaveBeenCalled();
    expect(persistence.createStatusHistory).not.toHaveBeenCalled();
  });

  it('rejects a missing ride without any writes', async () => {
    const persistence = fakePersistence({
      lockRide: vi.fn().mockResolvedValue(null),
      updateRideStatus: vi.fn(),
      createStatusHistory: vi.fn(),
    });
    const promise = run(completeRide, persistence, {
      rideId,
      actorId: creatorId,
    });
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    expect(persistence.updateRideStatus).not.toHaveBeenCalled();
    expect(persistence.createStatusHistory).not.toHaveBeenCalled();
  });

  it('rejects malformed input before touching the transaction', async () => {
    const runTransaction = vi.fn();
    const deps = {
      runTransaction:
        runTransaction as unknown as RideLifecycleDependencies['runTransaction'],
    };
    await expect(
      completeRide({ rideId: '', actorId: creatorId }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('creator lifecycle — shared safety properties', () => {
  it('publishes the successful realtime event only after the transaction', async () => {
    const persistence = happyPersistence(RideStatus.DRAFT);
    let eventsPublished = false;
    const publishEvents = vi.fn(async () => {
      eventsPublished = true;
    });

    await publishRide(
      { rideId, actorId: creatorId },
      {
        runTransaction: async (work) => work(persistence),
        publishEvents,
      },
    );

    expect(eventsPublished).toBe(true);
  });

  it('does not publish events when the transaction throws', async () => {
    const persistence = happyPersistence(RideStatus.DRAFT);
    persistence.updateRideStatus = vi.fn().mockRejectedValue(new Error('boom'));
    const publishEvents = vi.fn();

    await expect(
      publishRide(
        { rideId, actorId: creatorId },
        {
          runTransaction: async (work) => work(persistence),
          publishEvents,
        },
      ),
    ).rejects.toBeInstanceOf(InternalError);

    expect(publishEvents).not.toHaveBeenCalled();
  });
});
