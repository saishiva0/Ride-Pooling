/**
 * Unit tests for the Phase 3.6 ride request rejection use case.
 *
 * No PostgreSQL required: the `runTransaction` persistence port is faked.
 * Covers input validation, actor rules, the pending-request gate, result
 * mapping, the guarantee that no participant is created / no seat allocated /
 * no ride state touched, and error translation.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  NotificationType,
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
import { rejectRideRequest } from './reject-ride-request.js';
import type {
  RejectedRideRequest,
  RideRequestDecisionInput,
} from './reject-ride-request.js';
import type {
  RideRequestDecisionDependencies,
  RideRequestDecisionPersistence,
} from './ride-request-decision.js';
import type {
  LockedRideRow,
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

function happyPersistence(): RideRequestDecisionPersistence {
  return fakePersistence({
    findRequest: vi.fn().mockResolvedValue(requestRow()),
    lockRideForDecision: vi.fn().mockResolvedValue(lockedRide()),
    updateRequestStatus: vi
      .fn()
      .mockImplementation((params: { status: RideRequestStatus }) =>
        requestRow({ status: params.status, resolvedAt: new Date() }),
      ),
    createNotification: vi.fn().mockResolvedValue({ id: 'notification-1' }),
  });
}

async function run(
  persistence: RideRequestDecisionPersistence,
  input: RideRequestDecisionInput,
): Promise<RejectedRideRequest> {
  return rejectRideRequest(input, {
    runTransaction: async (work) => work(persistence),
  });
}

const validInput: RideRequestDecisionInput = {
  requestId,
  actorId: creatorId,
};

describe('rejectRideRequest — happy path', () => {
  it('moves the request to REJECTED and returns the typed result', async () => {
    const persistence = happyPersistence();
    const result = await run(persistence, validInput);

    expect(result).toEqual({
      requestId,
      requestStatus: RideRequestStatus.REJECTED,
      rideId,
    });

    expect(persistence.updateRequestStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId,
        status: RideRequestStatus.REJECTED,
      }),
    );
    const updateCall = vi.mocked(persistence.updateRequestStatus).mock
      .calls[0]![0] as { resolvedAt: Date };
    expect(updateCall.resolvedAt).toBeInstanceOf(Date);

    // Phase 3.8: a REQUEST_REJECTED notification is drafted for the requester
    // in the same transaction as the rejection.
    expect(persistence.createNotification).toHaveBeenCalledWith({
      userId: requesterId,
      type: NotificationType.REQUEST_REJECTED,
      title: 'Ride request rejected',
      body: 'Your ride request was declined',
      rideId,
      requestId,
    });
  });

  it('creates no participant, allocates no seats, and leaves the ride untouched', async () => {
    const persistence = happyPersistence();
    await run(persistence, validInput);

    expect(persistence.createParticipant).not.toHaveBeenCalled();
    expect(persistence.countConfirmedSeats).not.toHaveBeenCalled();
    expect(persistence.findParticipantByRequest).not.toHaveBeenCalled();
    expect(persistence.updateRideStatus).not.toHaveBeenCalled();
    expect(persistence.createStatusHistory).not.toHaveBeenCalled();
  });
});

describe('rejectRideRequest — missing entities', () => {
  it('rejects a missing request without any writes', async () => {
    const persistence = fakePersistence({
      findRequest: vi.fn().mockResolvedValue(null),
      updateRequestStatus: vi.fn(),
    });

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(persistence.lockRideForDecision).not.toHaveBeenCalled();
    expect(persistence.updateRequestStatus).not.toHaveBeenCalled();
  });

  it('rejects a missing ride', async () => {
    const persistence = happyPersistence();
    persistence.lockRideForDecision = vi.fn().mockResolvedValue(null);

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(persistence.updateRequestStatus).not.toHaveBeenCalled();
  });
});

describe('rejectRideRequest — actor rules', () => {
  it('rejects a non-creator actor', async () => {
    const persistence = happyPersistence();
    const promise = run(persistence, { requestId, actorId: 'stranger' });
    await expect(promise).rejects.toBeInstanceOf(AuthorizationError);
    await expect(promise).rejects.toMatchObject({
      code: 'AUTHORIZATION_ERROR',
      statusCode: 403,
    });
    expect(persistence.updateRequestStatus).not.toHaveBeenCalled();
  });

  it('rejects the requester acting on their own request', async () => {
    const persistence = happyPersistence();
    const promise = run(persistence, { requestId, actorId: requesterId });
    await expect(promise).rejects.toBeInstanceOf(BusinessRuleError);
    expect(persistence.updateRequestStatus).not.toHaveBeenCalled();
  });
});

describe('rejectRideRequest — request state rule', () => {
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
    expect(persistence.updateRequestStatus).not.toHaveBeenCalled();
  });
});

describe('rejectRideRequest — input validation', () => {
  it('rejects malformed input before touching the transaction', async () => {
    const runTransaction = vi.fn();
    const deps = {
      runTransaction:
        runTransaction as unknown as RideRequestDecisionDependencies['runTransaction'],
    };

    await expect(
      rejectRideRequest({ requestId: '', actorId: creatorId }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      rejectRideRequest({ requestId, actorId: '   ' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('rejectRideRequest — error translation', () => {
  it('translates a foreign-key race into a NotFoundError', async () => {
    const persistence = happyPersistence();
    persistence.updateRequestStatus = vi
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
