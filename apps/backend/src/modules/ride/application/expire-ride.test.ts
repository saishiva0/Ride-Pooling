/**
 * Unit tests for the Phase 3.7 ride expiration use case.
 *
 * No PostgreSQL required: the `runTransaction` persistence port is faked.
 * Fixed timestamps are used throughout — no wall-clock time — so reference
 * time behaviour is deterministic. Covers eligibility (status + departure
 * window + explicit OD-002 grace window), the idempotent no-op for ineligible
 * rides, correct EXPIRED transition + history (system actor), input
 * validation, and error translation.
 */
import { describe, expect, it, vi } from 'vitest';
import { NotificationType, RideStatus } from '@prisma/client';
import {
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import {
  DEFAULT_RIDE_EXPIRATION_GRACE_MS,
  expireRide,
  RIDE_EXPIRED_REASON,
} from './expire-ride.js';
import type { ExpireRideInput, ExpiredRide } from './expire-ride.js';
import type {
  RideLifecycleDependencies,
  RideLifecyclePersistence,
} from './ride-lifecycle.js';
import type { LockedRideLifecycleRow } from '../infrastructure/ride.repository.js';

const REF = new Date('2026-08-20T10:00:00.000Z');
const DEPARTURE_PAST = new Date('2026-08-20T09:59:59.000Z');
const DEPARTURE_FUTURE = new Date('2026-08-20T10:00:01.000Z');

const rideId = 'ride-1';

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

function lockedRide(
  overrides: Partial<LockedRideLifecycleRow> = {},
): LockedRideLifecycleRow {
  return {
    id: rideId,
    creatorId: 'creator-1',
    status: RideStatus.PUBLISHED,
    departureDateTime: DEPARTURE_PAST,
    ...overrides,
  };
}

function happyPersistence(): RideLifecyclePersistence {
  return fakePersistence({
    lockRide: vi.fn().mockResolvedValue(lockedRide()),
    updateRideStatus: vi.fn().mockResolvedValue({
      id: rideId,
      status: RideStatus.EXPIRED,
    }),
    createStatusHistory: vi.fn().mockResolvedValue({ id: 'history-1' }),
    findConfirmedParticipantIds: vi.fn().mockResolvedValue([]),
    createNotification: vi.fn().mockResolvedValue({ id: 'notification-1' }),
  });
}

async function run(
  persistence: RideLifecyclePersistence,
  input: ExpireRideInput,
): Promise<ExpiredRide> {
  return expireRide(input, {
    runTransaction: async (work) => work(persistence),
  });
}

const validInput: ExpireRideInput = { rideId, referenceTime: REF };

describe('expireRide — eligible ride', () => {
  it('expires a PUBLISHED ride whose departure has passed and writes history', async () => {
    const persistence = happyPersistence();
    const result = await run(persistence, validInput);

    expect(result).toEqual({
      rideId,
      status: RideStatus.EXPIRED,
      statusChanged: true,
    });
    expect(persistence.updateRideStatus).toHaveBeenCalledWith({
      rideId,
      status: RideStatus.EXPIRED,
    });
    expect(persistence.createStatusHistory).toHaveBeenCalledWith({
      rideId,
      fromStatus: RideStatus.PUBLISHED,
      toStatus: RideStatus.EXPIRED,
      // The system is the actor for expiration (ride-lifecycle.md §2.7).
      changedByUserId: null,
      reason: RIDE_EXPIRED_REASON,
    });
  });

  it('creates a RIDE_EXPIRED notification for the creator and confirmed participants', async () => {
    const persistence = happyPersistence();
    persistence.findConfirmedParticipantIds = vi
      .fn()
      .mockResolvedValue(['participant-1']);

    await run(persistence, validInput);

    expect(persistence.findConfirmedParticipantIds).toHaveBeenCalledWith(
      rideId,
    );
    const calls = vi
      .mocked(persistence.createNotification)
      .mock.calls.map((call) => call[0]);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.userId).sort()).toEqual([
      'creator-1',
      'participant-1',
    ]);
    for (const call of calls) {
      expect(call).toMatchObject({
        type: NotificationType.RIDE_EXPIRED,
        rideId,
        title: 'Ride expired',
      });
    }
  });

  it('uses the explicit default grace window of 0 (OD-002 baseline)', () => {
    expect(DEFAULT_RIDE_EXPIRATION_GRACE_MS).toBe(0);
  });
});

describe('expireRide — reference-time behaviour', () => {
  it('does nothing when the departure has not passed (future departure)', async () => {
    const persistence = happyPersistence();
    persistence.lockRide = vi
      .fn()
      .mockResolvedValue(lockedRide({ departureDateTime: DEPARTURE_FUTURE }));

    const result = await run(persistence, validInput);

    expect(result).toEqual({
      rideId,
      status: RideStatus.PUBLISHED,
      statusChanged: false,
    });
    expect(persistence.updateRideStatus).not.toHaveBeenCalled();
    expect(persistence.createStatusHistory).not.toHaveBeenCalled();
  });

  it('does nothing when a supplied grace window covers the departure (OD-002 policy)', async () => {
    const persistence = happyPersistence();

    const result = await run(persistence, {
      ...validInput,
      graceWindowMs: 5000,
    });

    expect(result).toEqual({
      rideId,
      status: RideStatus.PUBLISHED,
      statusChanged: false,
    });
    expect(persistence.updateRideStatus).not.toHaveBeenCalled();
    expect(persistence.createStatusHistory).not.toHaveBeenCalled();
  });

  it('is idempotent: repeating expiration never duplicates history or re-transitions', async () => {
    const persistence = happyPersistence();

    // First run: eligible → expires.
    const first = await run(persistence, validInput);
    expect(first).toEqual({
      rideId,
      status: RideStatus.EXPIRED,
      statusChanged: true,
    });
    expect(persistence.updateRideStatus).toHaveBeenCalledTimes(1);
    expect(persistence.createStatusHistory).toHaveBeenCalledTimes(1);

    // Second run: the ride is now already EXPIRED → safe no-op.
    persistence.lockRide = vi
      .fn()
      .mockResolvedValue(lockedRide({ status: RideStatus.EXPIRED }));
    const second = await run(persistence, validInput);
    expect(second).toEqual({
      rideId,
      status: RideStatus.EXPIRED,
      statusChanged: false,
    });
    expect(persistence.updateRideStatus).toHaveBeenCalledTimes(1);
    expect(persistence.createStatusHistory).toHaveBeenCalledTimes(1);
  });
});

describe('expireRide — ineligible rides are left unchanged (idempotent)', () => {
  it.each([
    RideStatus.DRAFT,
    RideStatus.CONFIRMED,
    RideStatus.IN_PROGRESS,
    RideStatus.COMPLETED,
    RideStatus.CANCELLED,
    RideStatus.EXPIRED,
  ])('does nothing for a %s ride', async (status) => {
    const persistence = happyPersistence();
    persistence.lockRide = vi.fn().mockResolvedValue(lockedRide({ status }));

    const result = await run(persistence, validInput);

    expect(result).toEqual({ rideId, status, statusChanged: false });
    expect(persistence.updateRideStatus).not.toHaveBeenCalled();
    expect(persistence.createStatusHistory).not.toHaveBeenCalled();
  });
});

describe('expireRide — missing ride', () => {
  it('throws NotFoundError for a missing ride', async () => {
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

describe('expireRide — input validation', () => {
  it('rejects malformed input before touching the transaction', async () => {
    const runTransaction = vi.fn();
    const deps = {
      runTransaction:
        runTransaction as unknown as RideLifecycleDependencies['runTransaction'],
    };

    await expect(
      expireRide({ rideId: '', referenceTime: REF }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      expireRide({ rideId, referenceTime: new Date('invalid') }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      expireRide({ rideId, referenceTime: REF, graceWindowMs: -1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('expireRide — error translation', () => {
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
