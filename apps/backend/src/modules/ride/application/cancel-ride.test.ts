/**
 * Unit tests for the Phase 3.7 ride cancellation use case.
 *
 * No PostgreSQL required: the `runTransaction` persistence port is faked.
 * Covers input validation, missing ride, creator authorization, cancellable
 * states (DRAFT/PUBLISHED/CONFIRMED/IN_PROGRESS), terminal-state rejection
 * (repeated cancellation), correct status/history writes, and error
 * translation (P2025/P2003 → NotFoundError, unexpected → InternalError).
 */
import { describe, expect, it, vi } from 'vitest';
import { NotificationType, RideStatus } from '@prisma/client';
import {
  AuthorizationError,
  BusinessRuleError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import { cancelRide, RIDE_CANCELLED_REASON } from './cancel-ride.js';
import type { CancelRideInput, CancelledRide } from './cancel-ride.js';
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
    status: RideStatus.PUBLISHED,
    departureDateTime: new Date('2026-08-20T10:00:00.000Z'),
    ...overrides,
  };
}

function happyPersistence(): RideLifecyclePersistence {
  return fakePersistence({
    lockRide: vi.fn().mockResolvedValue(lockedRide()),
    updateRideStatus: vi.fn().mockResolvedValue({
      id: rideId,
      status: RideStatus.CANCELLED,
    }),
    createStatusHistory: vi.fn().mockResolvedValue({ id: 'history-1' }),
    findConfirmedParticipantIds: vi.fn().mockResolvedValue([]),
    createNotification: vi.fn().mockResolvedValue({ id: 'notification-1' }),
  });
}

async function run(
  persistence: RideLifecyclePersistence,
  input: CancelRideInput,
): Promise<CancelledRide> {
  return cancelRide(input, {
    runTransaction: async (work) => work(persistence),
  });
}

const validInput: CancelRideInput = { rideId, actorId: creatorId };

describe('cancelRide — valid cancellation', () => {
  it.each([
    RideStatus.DRAFT,
    RideStatus.PUBLISHED,
    RideStatus.CONFIRMED,
    RideStatus.IN_PROGRESS,
  ])('cancels a %s ride and returns a typed result', async (status) => {
    const persistence = happyPersistence();
    persistence.lockRide = vi.fn().mockResolvedValue(lockedRide({ status }));

    const result = await run(persistence, validInput);

    expect(result).toEqual({
      rideId,
      status: RideStatus.CANCELLED,
      cancelledAt: expect.any(Date),
    });
    expect(persistence.updateRideStatus).toHaveBeenCalledWith({
      rideId,
      status: RideStatus.CANCELLED,
    });
    expect(persistence.createStatusHistory).toHaveBeenCalledWith({
      rideId,
      fromStatus: status,
      toStatus: RideStatus.CANCELLED,
      changedByUserId: creatorId,
      reason: RIDE_CANCELLED_REASON,
    });
  });

  it('creates a RIDE_CANCELLED notification for the creator and confirmed participants', async () => {
    const persistence = happyPersistence();
    persistence.findConfirmedParticipantIds = vi
      .fn()
      .mockResolvedValue(['participant-1', 'participant-1', 'participant-2']);

    await run(persistence, validInput);

    expect(persistence.findConfirmedParticipantIds).toHaveBeenCalledWith(
      rideId,
    );
    const calls = vi
      .mocked(persistence.createNotification)
      .mock.calls.map((call) => call[0]);
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.userId).sort()).toEqual([
      creatorId,
      'participant-1',
      'participant-2',
    ]);
    for (const call of calls) {
      expect(call).toMatchObject({
        type: NotificationType.RIDE_CANCELLED,
        rideId,
        title: 'Ride cancelled',
      });
    }
  });
});

describe('cancelRide — terminal states', () => {
  it.each([RideStatus.COMPLETED, RideStatus.CANCELLED, RideStatus.EXPIRED])(
    'rejects cancellation from the terminal state %s without writes',
    async (status) => {
      const persistence = happyPersistence();
      persistence.lockRide = vi.fn().mockResolvedValue(lockedRide({ status }));

      const promise = run(persistence, validInput);
      await expect(promise).rejects.toBeInstanceOf(BusinessRuleError);
      await expect(promise).rejects.toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        statusCode: 422,
        details: { rideId, status },
      });
      expect(persistence.updateRideStatus).not.toHaveBeenCalled();
      expect(persistence.createStatusHistory).not.toHaveBeenCalled();
    },
  );
});

describe('cancelRide — creator authorization', () => {
  it('rejects a non-creator actor', async () => {
    const persistence = happyPersistence();
    const promise = run(persistence, { rideId, actorId: 'stranger' });
    await expect(promise).rejects.toBeInstanceOf(AuthorizationError);
    await expect(promise).rejects.toMatchObject({
      code: 'AUTHORIZATION_ERROR',
      statusCode: 403,
    });
    expect(persistence.updateRideStatus).not.toHaveBeenCalled();
    expect(persistence.createStatusHistory).not.toHaveBeenCalled();
  });
});

describe('cancelRide — missing ride', () => {
  it('rejects a missing ride without any writes', async () => {
    const persistence = fakePersistence({
      lockRide: vi.fn().mockResolvedValue(null),
      updateRideStatus: vi.fn(),
      createStatusHistory: vi.fn(),
    });

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    await expect(promise).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
    expect(persistence.updateRideStatus).not.toHaveBeenCalled();
    expect(persistence.createStatusHistory).not.toHaveBeenCalled();
  });
});

describe('cancelRide — input validation', () => {
  it('rejects malformed input before touching the transaction', async () => {
    const runTransaction = vi.fn();
    const deps = {
      runTransaction:
        runTransaction as unknown as RideLifecycleDependencies['runTransaction'],
    };

    await expect(
      cancelRide({ rideId: '', actorId: creatorId }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      cancelRide({ rideId, actorId: '   ' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('cancelRide — error translation', () => {
  it('propagates an AppError raised by persistence', async () => {
    const persistence = happyPersistence();
    persistence.updateRideStatus = vi
      .fn()
      .mockRejectedValue(new NotFoundError('nope', { field: 'rideId' }));

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('translates a P2025 write failure into a NotFoundError', async () => {
    const persistence = happyPersistence();
    persistence.updateRideStatus = vi
      .fn()
      .mockRejectedValue(new Error('P2025'));
    persistence.classifyError = vi.fn(
      (_err: unknown): 'not_found' | 'foreign_key' | null => 'not_found',
    );

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    await expect(promise).rejects.not.toThrow('P2025');
  });

  it('translates a foreign-key history failure into a NotFoundError', async () => {
    const persistence = happyPersistence();
    persistence.createStatusHistory = vi
      .fn()
      .mockRejectedValue(new Error('P2003'));
    persistence.classifyError = vi.fn(
      (_err: unknown): 'not_found' | 'foreign_key' | null => 'foreign_key',
    );

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    await expect(promise).rejects.not.toThrow('P2003');
  });

  it('wraps an unexpected persistence failure without leaking it directly', async () => {
    const persistence = happyPersistence();
    persistence.updateRideStatus = vi
      .fn()
      .mockRejectedValue(new Error('connection reset by peer'));

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(InternalError);
    await expect(promise).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    });
    await expect(promise).rejects.not.toThrow('connection reset by peer');
  });
});
