/**
 * Unit tests for the Phase 3.21 ride request / participation cancellation use
 * case.
 *
 * No PostgreSQL required: the `runTransaction` persistence port is faked.
 * Covers input validation, owner authorization, the PENDING-withdrawal path
 * (request → CANCELLED, ride unchanged), the ACCEPTED-participation-cancel
 * path (participant → CANCELLED, seat freed, request → CANCELLED), the
 * last-participant CONFIRMED → PUBLISHED revert (+ history), the IN_PROGRESS
 * prohibition (OD-011), already-resolved requests, the REQUEST_CANCELLED
 * notification to the creator, and error translation (P2025/P2003 →
 * NotFoundError, unexpected → InternalError).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  NotificationType,
  ParticipantStatus,
  RideRequestStatus,
  RideStatus,
} from '@prisma/client';
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import {
  cancelRideRequest,
  LAST_PARTICIPANT_CANCELLED_REASON,
} from './cancel-ride-request.js';
import type {
  CancelledRideRequest,
  RideRequestCancellationInput,
} from './cancel-ride-request.js';
import type {
  RideRequestCancellationDependencies,
  RideRequestCancellationPersistence,
} from './ride-request-cancellation.js';
import type {
  CancelableParticipantRow,
  LockedRideRow,
  PersistedRideRequest,
} from '../infrastructure/ride.repository.js';

function fakePersistence(
  overrides: Partial<RideRequestCancellationPersistence> = {},
): RideRequestCancellationPersistence {
  return {
    findRequest: vi.fn(),
    lockRideForDecision: vi.fn(),
    findParticipantForCancellation: vi.fn(),
    countConfirmedSeats: vi.fn(),
    updateParticipantStatus: vi.fn(),
    updateRequestStatus: vi.fn(),
    updateRideStatus: vi.fn(),
    createStatusHistory: vi.fn(),
    createNotification: vi.fn(),
    classifyError: vi.fn(() => null),
    ...overrides,
  };
}

const creatorId = 'creator-1';
const participantId = 'participant-1';
const rideId = 'ride-1';
const requestId = 'req-1';

function requestRow(
  overrides: Partial<PersistedRideRequest> = {},
): PersistedRideRequest {
  return {
    id: requestId,
    rideId,
    userId: participantId,
    requestedSeats: 2,
    status: RideRequestStatus.PENDING,
    createdAt: new Date('2026-08-20T10:00:00.000Z'),
    updatedAt: new Date('2026-08-20T10:00:00.000Z'),
    resolvedAt: null,
    ...overrides,
  };
}

function lockedRide(overrides: Partial<LockedRideRow> = {}): LockedRideRow {
  return {
    id: rideId,
    creatorId,
    status: RideStatus.CONFIRMED,
    totalSeats: 4,
    ...overrides,
  };
}

function participantRow(
  overrides: Partial<CancelableParticipantRow> = {},
): CancelableParticipantRow {
  return {
    id: participantId,
    userId: participantId,
    seatsAllocated: 2,
    status: ParticipantStatus.CONFIRMED,
    ...overrides,
  };
}

function happyPersistence(
  requestOverrides: Partial<PersistedRideRequest> = {},
  rideOverrides: Partial<LockedRideRow> = {},
): RideRequestCancellationPersistence {
  return fakePersistence({
    findRequest: vi.fn().mockResolvedValue(requestRow(requestOverrides)),
    lockRideForDecision: vi.fn().mockResolvedValue(lockedRide(rideOverrides)),
    findParticipantForCancellation: vi.fn().mockResolvedValue(participantRow()),
    countConfirmedSeats: vi.fn().mockResolvedValue(2),
    updateParticipantStatus: vi
      .fn()
      .mockImplementation((params: { id: string }) => ({
        id: params.id,
        status: ParticipantStatus.CANCELLED,
      })),
    updateRequestStatus: vi
      .fn()
      .mockImplementation((params: { status: RideRequestStatus }) =>
        requestRow({ status: params.status, resolvedAt: new Date() }),
      ),
    updateRideStatus: vi
      .fn()
      .mockImplementation((params: { status: RideStatus }) =>
        lockedRide({ status: params.status }),
      ),
    createStatusHistory: vi.fn().mockResolvedValue({ id: 'history-1' }),
    createNotification: vi.fn().mockResolvedValue({ id: 'notification-1' }),
  });
}

async function run(
  persistence: RideRequestCancellationPersistence,
  input: RideRequestCancellationInput,
  publishEvents = vi.fn(),
): Promise<CancelledRideRequest> {
  return cancelRideRequest(input, {
    runTransaction: async (work) => work(persistence),
    publishEvents,
  });
}

const validInput: RideRequestCancellationInput = {
  requestId,
  actorId: participantId,
};

describe('cancelRideRequest — PENDING withdrawal', () => {
  it('cancels the request, leaves the ride untouched, and notifies the creator', async () => {
    const persistence = happyPersistence(
      { status: RideRequestStatus.PENDING },
      { status: RideStatus.PUBLISHED },
    );
    const publishEvents = vi.fn();
    const result = await run(persistence, validInput, publishEvents);

    expect(result).toEqual({
      requestId,
      requestStatus: RideRequestStatus.CANCELLED,
      rideId,
      participantId: null,
      participantStatus: null,
      releasedSeats: 0,
      rideStatus: RideStatus.PUBLISHED,
      rideStatusChanged: false,
      cancelledAt: expect.any(Date) as Date,
    });

    expect(persistence.updateRequestStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId,
        status: RideRequestStatus.CANCELLED,
      }),
    );
    // No participant / ride writes on a PENDING withdrawal.
    expect(persistence.findParticipantForCancellation).not.toHaveBeenCalled();
    expect(persistence.updateParticipantStatus).not.toHaveBeenCalled();
    expect(persistence.updateRideStatus).not.toHaveBeenCalled();
    expect(persistence.createStatusHistory).not.toHaveBeenCalled();

    // Phase 3.8: REQUEST_CANCELLED → the ride creator.
    expect(persistence.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: creatorId,
        type: NotificationType.REQUEST_CANCELLED,
        rideId,
        requestId,
      }),
    );
    expect(publishEvents).toHaveBeenCalledTimes(1);
  });
});

describe('cancelRideRequest — ACCEPTED participation cancel (not last)', () => {
  it('frees the seat, cancels the request, and keeps the ride CONFIRMED', async () => {
    const persistence = happyPersistence({
      status: RideRequestStatus.ACCEPTED,
    });
    const result = await run(persistence, validInput);

    expect(result).toEqual({
      requestId,
      requestStatus: RideRequestStatus.CANCELLED,
      rideId,
      participantId: participantId,
      participantStatus: ParticipantStatus.CANCELLED,
      releasedSeats: 2,
      rideStatus: RideStatus.CONFIRMED,
      rideStatusChanged: false,
      cancelledAt: expect.any(Date) as Date,
    });

    expect(persistence.updateParticipantStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: participantId }),
    );
    const cancelCall = vi.mocked(persistence.updateParticipantStatus).mock
      .calls[0]![0] as { cancelledAt: Date };
    expect(cancelCall.cancelledAt).toBeInstanceOf(Date);

    expect(persistence.updateRequestStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: RideRequestStatus.CANCELLED }),
    );
    // Not the last participant (2 confirmed seats remain): no ride revert.
    expect(persistence.updateRideStatus).not.toHaveBeenCalled();
    expect(persistence.createStatusHistory).not.toHaveBeenCalled();
    expect(result.rideStatusChanged).toBe(false);

    expect(persistence.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: creatorId,
        type: NotificationType.REQUEST_CANCELLED,
        rideId,
        requestId,
      }),
    );
  });
});

describe('cancelRideRequest — ACCEPTED participation cancel, last participant', () => {
  it('reverts the ride CONFIRMED → PUBLISHED and writes history', async () => {
    const persistence = happyPersistence({
      status: RideRequestStatus.ACCEPTED,
    });
    persistence.countConfirmedSeats = vi.fn().mockResolvedValue(0);

    const result = await run(persistence, validInput);

    expect(result.rideStatus).toBe(RideStatus.PUBLISHED);
    expect(result.rideStatusChanged).toBe(true);

    expect(persistence.updateRideStatus).toHaveBeenCalledWith({
      rideId,
      status: RideStatus.PUBLISHED,
    });
    expect(persistence.createStatusHistory).toHaveBeenCalledWith({
      rideId,
      fromStatus: RideStatus.CONFIRMED,
      toStatus: RideStatus.PUBLISHED,
      changedByUserId: participantId,
      reason: LAST_PARTICIPANT_CANCELLED_REASON,
    });
  });

  it('does not revert when the ride was already PUBLISHED', async () => {
    const persistence = happyPersistence(
      { status: RideRequestStatus.ACCEPTED },
      { status: RideStatus.PUBLISHED },
    );
    persistence.countConfirmedSeats = vi.fn().mockResolvedValue(0);

    const result = await run(persistence, validInput);

    expect(result.rideStatus).toBe(RideStatus.PUBLISHED);
    expect(result.rideStatusChanged).toBe(false);
    expect(persistence.updateRideStatus).not.toHaveBeenCalled();
    expect(persistence.createStatusHistory).not.toHaveBeenCalled();
  });
});

describe('cancelRideRequest — missing entities', () => {
  it('rejects a missing request without any writes', async () => {
    const persistence = fakePersistence({
      findRequest: vi.fn().mockResolvedValue(null),
      updateRequestStatus: vi.fn(),
      updateParticipantStatus: vi.fn(),
      updateRideStatus: vi.fn(),
      createStatusHistory: vi.fn(),
    });

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(persistence.lockRideForDecision).not.toHaveBeenCalled();
    expect(persistence.updateRequestStatus).not.toHaveBeenCalled();
  });

  it('rejects a missing ride after the request load', async () => {
    const persistence = happyPersistence();
    persistence.lockRideForDecision = vi.fn().mockResolvedValue(null);

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(persistence.updateRequestStatus).not.toHaveBeenCalled();
  });

  it('rejects a request whose ride vanished between reads', async () => {
    const persistence = happyPersistence();
    persistence.findRequest = vi
      .fn()
      .mockResolvedValueOnce(requestRow())
      .mockResolvedValueOnce(null);

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(persistence.updateRequestStatus).not.toHaveBeenCalled();
  });
});

describe('cancelRideRequest — actor rules', () => {
  it('rejects a non-owner actor (e.g. the ride creator)', async () => {
    const persistence = happyPersistence({ status: RideRequestStatus.PENDING });
    const promise = run(persistence, { requestId, actorId: creatorId });

    await expect(promise).rejects.toBeInstanceOf(AuthorizationError);
    await expect(promise).rejects.toMatchObject({
      code: 'AUTHORIZATION_ERROR',
      statusCode: 403,
    });
    expect(persistence.updateRequestStatus).not.toHaveBeenCalled();
  });
});

describe('cancelRideRequest — request state rules', () => {
  it.each([RideRequestStatus.REJECTED, RideRequestStatus.CANCELLED])(
    'rejects an already-resolved %s request',
    async (status) => {
      const persistence = happyPersistence({ status });
      const promise = run(persistence, validInput);

      await expect(promise).rejects.toBeInstanceOf(ConflictError);
      await expect(promise).rejects.toMatchObject({
        code: 'CONFLICT',
        statusCode: 409,
      });
      expect(persistence.updateRequestStatus).not.toHaveBeenCalled();
      expect(persistence.updateParticipantStatus).not.toHaveBeenCalled();
    },
  );
});

describe('cancelRideRequest — ride state rule', () => {
  it('rejects cancelling an ACCEPTED participation on an IN_PROGRESS ride (OD-011)', async () => {
    const persistence = happyPersistence(
      { status: RideRequestStatus.ACCEPTED },
      { status: RideStatus.IN_PROGRESS },
    );

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(promise).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      statusCode: 422,
    });
    expect(persistence.updateParticipantStatus).not.toHaveBeenCalled();
    expect(persistence.updateRequestStatus).not.toHaveBeenCalled();
  });
});

describe('cancelRideRequest — participation integrity', () => {
  it('rejects when no participant exists for the accepted request', async () => {
    const persistence = happyPersistence({
      status: RideRequestStatus.ACCEPTED,
    });
    persistence.findParticipantForCancellation = vi
      .fn()
      .mockResolvedValue(null);

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(ConflictError);
    expect(persistence.updateParticipantStatus).not.toHaveBeenCalled();
  });

  it('rejects when the participant is already cancelled', async () => {
    const persistence = happyPersistence({
      status: RideRequestStatus.ACCEPTED,
    });
    persistence.findParticipantForCancellation = vi
      .fn()
      .mockResolvedValue(
        participantRow({ status: ParticipantStatus.CANCELLED }),
      );

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(ConflictError);
    expect(persistence.updateParticipantStatus).not.toHaveBeenCalled();
  });
});

describe('cancelRideRequest — input validation', () => {
  it('rejects malformed input before touching the transaction', async () => {
    const runTransaction = vi.fn();
    const deps = {
      runTransaction:
        runTransaction as unknown as RideRequestCancellationDependencies['runTransaction'],
    };

    await expect(
      cancelRideRequest({ requestId: '', actorId: participantId }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      cancelRideRequest({ requestId, actorId: '   ' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('cancelRideRequest — error translation', () => {
  it('propagates an AppError raised by persistence', async () => {
    const persistence = happyPersistence({ status: RideRequestStatus.PENDING });
    persistence.updateRequestStatus = vi
      .fn()
      .mockRejectedValue(new NotFoundError('nope', { field: 'requestId' }));

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('translates a vanished-row race (P2025) into a NotFoundError', async () => {
    const persistence = happyPersistence({ status: RideRequestStatus.PENDING });
    persistence.updateRequestStatus = vi
      .fn()
      .mockRejectedValue(new Error('P2025'));
    persistence.classifyError = vi.fn(
      (_err: unknown): 'not_found' | 'foreign_key' | null => 'not_found',
    );

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    await expect(promise).rejects.not.toThrow('P2025');
  });

  it('translates a foreign-key race (P2003) into a NotFoundError', async () => {
    const persistence = happyPersistence({ status: RideRequestStatus.PENDING });
    persistence.updateRequestStatus = vi
      .fn()
      .mockRejectedValue(new Error('P2003'));
    persistence.classifyError = vi.fn(
      (_err: unknown): 'not_found' | 'foreign_key' | null => 'foreign_key',
    );

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
  });

  it('wraps an unexpected persistence failure without leaking it directly', async () => {
    const persistence = happyPersistence({ status: RideRequestStatus.PENDING });
    persistence.updateRequestStatus = vi
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
