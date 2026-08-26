/**
 * Unit tests for the Phase 3.6 ride request acceptance use case.
 *
 * No PostgreSQL required: the `runTransaction` persistence port is faked.
 * Covers input validation, actor rules, request/ride state rules, seat
 * validation, participant/request/ride/history mapping, the PUBLISHED →
 * CONFIRMED lifecycle transition (and its absence on a CONFIRMED ride), and
 * error translation (P2002 → ConflictError, P2003 → NotFoundError,
 * unexpected → InternalError).
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
  acceptRideRequest,
  FIRST_ACCEPTED_REASON,
} from './accept-ride-request.js';
import type {
  AcceptedRideRequest,
  RideRequestDecisionInput,
} from './accept-ride-request.js';
import type {
  RideRequestDecisionDependencies,
  RideRequestDecisionPersistence,
} from './ride-request-decision.js';
import type {
  LockedRideRow,
  PersistedRideParticipant,
  PersistedRideRequest,
} from '../infrastructure/ride.repository.js';

function fakePersistence(
  overrides: Partial<RideRequestDecisionPersistence> = {},
): RideRequestDecisionPersistence {
  return {
    findRequest: vi.fn(),
    lockRideForDecision: vi.fn(),
    countConfirmedSeats: vi.fn(),
    findParticipantByRequest: vi.fn(),
    createParticipant: vi.fn(),
    updateRequestStatus: vi.fn(),
    updateRideStatus: vi.fn(),
    createStatusHistory: vi.fn(),
    createNotification: vi.fn(),
    classifyError: vi.fn(() => null),
    ...overrides,
  };
}

const creatorId = 'creator-1';
const requesterId = 'requester-2';
const rideId = 'ride-1';
const requestId = 'req-1';

function requestRow(
  overrides: Partial<PersistedRideRequest> = {},
): PersistedRideRequest {
  return {
    id: requestId,
    rideId,
    userId: requesterId,
    requestedSeats: 1,
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
    status: RideStatus.PUBLISHED,
    totalSeats: 3,
    ...overrides,
  };
}

function participantRow(
  overrides: Partial<PersistedRideParticipant> = {},
): PersistedRideParticipant {
  return {
    id: 'participant-1',
    rideId,
    userId: requesterId,
    requestId,
    seatsAllocated: 1,
    status: ParticipantStatus.CONFIRMED,
    joinedAt: new Date('2026-08-20T10:00:00.000Z'),
    ...overrides,
  };
}

function happyPersistence(): RideRequestDecisionPersistence {
  return fakePersistence({
    findRequest: vi.fn().mockResolvedValue(requestRow()),
    lockRideForDecision: vi.fn().mockResolvedValue(lockedRide()),
    countConfirmedSeats: vi.fn().mockResolvedValue(0),
    findParticipantByRequest: vi.fn().mockResolvedValue(null),
    createParticipant: vi
      .fn()
      .mockImplementation((params: { seatsAllocated: number }) =>
        participantRow({ seatsAllocated: params.seatsAllocated }),
      ),
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
  persistence: RideRequestDecisionPersistence,
  input: RideRequestDecisionInput,
): Promise<AcceptedRideRequest> {
  return acceptRideRequest(input, {
    runTransaction: async (work) => work(persistence),
  });
}

const validInput: RideRequestDecisionInput = {
  requestId,
  actorId: creatorId,
};

describe('acceptRideRequest — happy path on a PUBLISHED ride', () => {
  it('creates the participant, accepts the request, transitions the ride to CONFIRMED, and writes history', async () => {
    const persistence = happyPersistence();
    const result = await run(persistence, validInput);

    expect(result).toEqual({
      requestId,
      requestStatus: RideRequestStatus.ACCEPTED,
      participantId: 'participant-1',
      participantStatus: ParticipantStatus.CONFIRMED,
      rideId,
      allocatedSeats: 1,
      rideStatus: RideStatus.CONFIRMED,
      rideStatusChanged: true,
    });

    expect(persistence.createParticipant).toHaveBeenCalledWith({
      rideId,
      userId: requesterId,
      requestId,
      seatsAllocated: 1,
      status: ParticipantStatus.CONFIRMED,
    });

    expect(persistence.updateRequestStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId,
        status: RideRequestStatus.ACCEPTED,
      }),
    );
    const updateCall = vi.mocked(persistence.updateRequestStatus).mock
      .calls[0]![0] as { resolvedAt: Date };
    expect(updateCall.resolvedAt).toBeInstanceOf(Date);

    expect(persistence.updateRideStatus).toHaveBeenCalledWith({
      rideId,
      status: RideStatus.CONFIRMED,
    });
    expect(persistence.createStatusHistory).toHaveBeenCalledWith({
      rideId,
      fromStatus: RideStatus.PUBLISHED,
      toStatus: RideStatus.CONFIRMED,
      changedByUserId: creatorId,
      reason: FIRST_ACCEPTED_REASON,
    });

    // Phase 3.8: REQUEST_ACCEPTED → the requester, and RIDE_CONFIRMED →
    // creator + confirmed requester, committed atomically with the acceptance.
    expect(persistence.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: requesterId,
        type: NotificationType.REQUEST_ACCEPTED,
        rideId,
        requestId,
      }),
    );
    expect(persistence.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: creatorId,
        type: NotificationType.RIDE_CONFIRMED,
        rideId,
      }),
    );
    expect(persistence.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: requesterId,
        type: NotificationType.RIDE_CONFIRMED,
        rideId,
      }),
    );
  });

  it('allocates exactly the requested seats', async () => {
    const persistence = happyPersistence();
    persistence.findRequest = vi
      .fn()
      .mockResolvedValue(requestRow({ requestedSeats: 2 }));
    const result = await run(persistence, validInput);
    expect(result.allocatedSeats).toBe(2);
    expect(persistence.createParticipant).toHaveBeenCalledWith(
      expect.objectContaining({ seatsAllocated: 2 }),
    );
  });
});

describe('acceptRideRequest — subsequent acceptance on a CONFIRMED ride', () => {
  it('keeps the ride CONFIRMED and writes no ride transition or history', async () => {
    const persistence = happyPersistence();
    persistence.lockRideForDecision = vi
      .fn()
      .mockResolvedValue(lockedRide({ status: RideStatus.CONFIRMED }));

    const result = await run(persistence, validInput);

    expect(result.rideStatus).toBe(RideStatus.CONFIRMED);
    expect(result.rideStatusChanged).toBe(false);
    expect(persistence.updateRideStatus).not.toHaveBeenCalled();
    expect(persistence.createStatusHistory).not.toHaveBeenCalled();
    expect(persistence.updateRequestStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: RideRequestStatus.ACCEPTED }),
    );
  });
});

describe('acceptRideRequest — missing entities', () => {
  it('rejects a missing request without any writes', async () => {
    const persistence = fakePersistence({
      findRequest: vi.fn().mockResolvedValue(null),
      createParticipant: vi.fn(),
      updateRequestStatus: vi.fn(),
      updateRideStatus: vi.fn(),
      createStatusHistory: vi.fn(),
    });

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(persistence.lockRideForDecision).not.toHaveBeenCalled();
    expect(persistence.createParticipant).not.toHaveBeenCalled();
  });

  it('rejects a missing ride after the request load', async () => {
    const persistence = happyPersistence();
    persistence.lockRideForDecision = vi.fn().mockResolvedValue(null);

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(persistence.createParticipant).not.toHaveBeenCalled();
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
    expect(persistence.createParticipant).not.toHaveBeenCalled();
  });
});

describe('acceptRideRequest — actor rules', () => {
  it('rejects a non-creator actor', async () => {
    const persistence = happyPersistence();
    const promise = run(persistence, { requestId, actorId: 'stranger' });
    await expect(promise).rejects.toBeInstanceOf(AuthorizationError);
    await expect(promise).rejects.toMatchObject({
      code: 'AUTHORIZATION_ERROR',
      statusCode: 403,
    });
    expect(persistence.createParticipant).not.toHaveBeenCalled();
  });

  it('rejects the requester acting on their own request', async () => {
    const persistence = happyPersistence();
    const promise = run(persistence, { requestId, actorId: requesterId });
    await expect(promise).rejects.toBeInstanceOf(BusinessRuleError);
    expect(persistence.createParticipant).not.toHaveBeenCalled();
  });
});

describe('acceptRideRequest — request state rule', () => {
  it.each([
    RideRequestStatus.ACCEPTED,
    RideRequestStatus.REJECTED,
    RideRequestStatus.CANCELLED,
  ])('rejects a request already in %s', async (status) => {
    const persistence = happyPersistence();
    persistence.findRequest = vi.fn().mockResolvedValue(requestRow({ status }));

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(ConflictError);
    await expect(promise).rejects.toMatchObject({
      code: 'CONFLICT',
      statusCode: 409,
    });
    expect(persistence.createParticipant).not.toHaveBeenCalled();
  });
});

describe('acceptRideRequest — ride state rule', () => {
  it.each([
    RideStatus.DRAFT,
    RideStatus.IN_PROGRESS,
    RideStatus.COMPLETED,
    RideStatus.CANCELLED,
    RideStatus.EXPIRED,
  ])('rejects a ride in %s', async (status) => {
    const persistence = happyPersistence();
    persistence.lockRideForDecision = vi
      .fn()
      .mockResolvedValue(lockedRide({ status }));

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(promise).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      statusCode: 422,
    });
    expect(persistence.createParticipant).not.toHaveBeenCalled();
  });
});

describe('acceptRideRequest — seat capacity', () => {
  it('rejects when the requested seats exceed availability', async () => {
    const persistence = happyPersistence();
    persistence.findRequest = vi
      .fn()
      .mockResolvedValue(requestRow({ requestedSeats: 2 }));
    persistence.lockRideForDecision = vi
      .fn()
      .mockResolvedValue(lockedRide({ totalSeats: 2 }));
    persistence.countConfirmedSeats = vi.fn().mockResolvedValue(1);

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(promise).rejects.toMatchObject({
      field: 'requestId',
      details: {
        requestedSeats: 2,
        availableSeats: 1,
        totalSeats: 2,
      },
    });
    expect(persistence.createParticipant).not.toHaveBeenCalled();
  });

  it('accepts a request that exactly fills the ride', async () => {
    const persistence = happyPersistence();
    persistence.findRequest = vi
      .fn()
      .mockResolvedValue(requestRow({ requestedSeats: 3 }));
    persistence.lockRideForDecision = vi
      .fn()
      .mockResolvedValue(lockedRide({ totalSeats: 3 }));

    const result = await run(persistence, validInput);
    expect(result.allocatedSeats).toBe(3);
    expect(result.rideStatus).toBe(RideStatus.CONFIRMED);
  });

  it('rejects when confirmed seats already fill the ride', async () => {
    const persistence = happyPersistence();
    persistence.lockRideForDecision = vi
      .fn()
      .mockResolvedValue(
        lockedRide({ status: RideStatus.CONFIRMED, totalSeats: 2 }),
      );
    persistence.countConfirmedSeats = vi.fn().mockResolvedValue(2);

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    expect(persistence.createParticipant).not.toHaveBeenCalled();
  });
});

describe('acceptRideRequest — duplicate participant protection', () => {
  it('rejects when a participant already exists for the request', async () => {
    const persistence = happyPersistence();
    persistence.findParticipantByRequest = vi
      .fn()
      .mockResolvedValue({ id: 'existing-participant' });

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(ConflictError);
    expect(persistence.createParticipant).not.toHaveBeenCalled();
  });
});

describe('acceptRideRequest — input validation', () => {
  it('rejects malformed input before touching the transaction', async () => {
    const runTransaction = vi.fn();
    const deps = {
      runTransaction:
        runTransaction as unknown as RideRequestDecisionDependencies['runTransaction'],
    };

    await expect(
      acceptRideRequest({ requestId: '', actorId: creatorId }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      acceptRideRequest({ requestId, actorId: '   ' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('acceptRideRequest — error translation', () => {
  it('propagates an AppError raised by persistence', async () => {
    const persistence = happyPersistence();
    persistence.createParticipant = vi
      .fn()
      .mockRejectedValue(new NotFoundError('nope', { field: 'rideId' }));

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('translates a unique-constraint race into a ConflictError', async () => {
    const persistence = happyPersistence();
    persistence.createParticipant = vi
      .fn()
      .mockRejectedValue(new Error('P2002'));
    persistence.classifyError = vi.fn(
      (_err: unknown): 'unique' | 'foreign_key' | null => 'unique',
    );

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(ConflictError);
    await expect(promise).rejects.not.toThrow('P2002');
  });

  it('translates a foreign-key race into a NotFoundError', async () => {
    const persistence = happyPersistence();
    persistence.createParticipant = vi
      .fn()
      .mockRejectedValue(new Error('P2003'));
    persistence.classifyError = vi.fn(
      (_err: unknown): 'unique' | 'foreign_key' | null => 'foreign_key',
    );

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('wraps an unexpected persistence failure without leaking it directly', async () => {
    const persistence = happyPersistence();
    persistence.createParticipant = vi
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
