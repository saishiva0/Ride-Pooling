/**
 * Unit tests for the Phase 3.5 ride request creation use case.
 *
 * No PostgreSQL required: the `runTransaction` persistence port is faked.
 * Covers input validation, business rules (self-request, requestable state,
 * seats, duplicate), error propagation and translation, initial status, and
 * deterministic result mapping.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  NotificationType,
  RideRequestStatus,
  RideStatus,
} from '@prisma/client';
import {
  BusinessRuleError,
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import { createRideRequest } from './create-ride-request.js';
import type {
  CreatedRideRequest,
  CreateRideRequestDependencies,
  RideRequestInput,
  RideRequestPersistence,
} from './create-ride-request.js';
import type { PersistedRideRequest } from '../infrastructure/ride.repository.js';

function fakePersistence(
  overrides: Partial<RideRequestPersistence> = {},
): RideRequestPersistence {
  return {
    findRequester: vi.fn(),
    findRideForRequest: vi.fn(),
    findActiveRequest: vi.fn(),
    createRequest: vi.fn(),
    createNotification: vi.fn(),
    classifyError: vi.fn(() => null),
    ...overrides,
  };
}

const requester = { id: 'user-1', name: 'Riya' };
const ride = {
  id: 'ride-1',
  creatorId: 'user-2',
  status: RideStatus.PUBLISHED,
  availableSeats: 3,
};

function persistedRecord(
  overrides: Partial<PersistedRideRequest> = {},
): PersistedRideRequest {
  return {
    id: 'req-1',
    rideId: 'ride-1',
    userId: 'user-1',
    requestedSeats: 1,
    status: RideRequestStatus.PENDING,
    createdAt: new Date('2026-08-20T10:00:00.000Z'),
    updatedAt: new Date('2026-08-20T10:00:00.000Z'),
    resolvedAt: null,
    ...overrides,
  };
}

function happyPersistence(): RideRequestPersistence {
  return fakePersistence({
    findRequester: vi.fn().mockResolvedValue(requester),
    findRideForRequest: vi.fn().mockResolvedValue(ride),
    findActiveRequest: vi.fn().mockResolvedValue(null),
    createRequest: vi
      .fn()
      .mockImplementation((params: { requestedSeats: number }) =>
        persistedRecord({ requestedSeats: params.requestedSeats }),
      ),
    createNotification: vi.fn().mockResolvedValue({ id: 'notification-1' }),
  });
}

async function run(
  persistence: RideRequestPersistence,
  input: RideRequestInput,
): Promise<CreatedRideRequest> {
  return createRideRequest(input, {
    runTransaction: async (work) => work(persistence),
  });
}

const validInput: RideRequestInput = {
  rideId: 'ride-1',
  requesterId: 'user-1',
};

describe('createRideRequest — happy path', () => {
  it('creates a PENDING request and maps the result deterministically', async () => {
    const persistence = happyPersistence();
    const result = await run(persistence, validInput);

    expect(result).toEqual({
      id: 'req-1',
      rideId: 'ride-1',
      requester: { id: 'user-1', name: 'Riya' },
      requestedSeats: 1,
      status: RideRequestStatus.PENDING,
      createdAt: new Date('2026-08-20T10:00:00.000Z'),
    });

    expect(persistence.createRequest).toHaveBeenCalledWith({
      rideId: 'ride-1',
      userId: 'user-1',
      requestedSeats: 1,
      status: RideRequestStatus.PENDING,
    });

    // Phase 3.8: a RIDE_REQUESTED notification is drafted for the creator in
    // the same transaction as the request insert.
    expect(persistence.createNotification).toHaveBeenCalledWith({
      userId: 'user-2',
      type: NotificationType.RIDE_REQUESTED,
      title: 'New ride request',
      body: 'Riya requested to join your ride',
      rideId: 'ride-1',
      requestId: 'req-1',
    });
  });

  it('defaults requestedSeats to 1 when omitted', async () => {
    const persistence = happyPersistence();
    await run(persistence, validInput);
    expect(persistence.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestedSeats: 1 }),
    );
  });

  it('passes through an explicit requestedSeats', async () => {
    const persistence = happyPersistence();
    await run(persistence, { ...validInput, requestedSeats: 2 });
    expect(persistence.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestedSeats: 2 }),
    );
  });
});

describe('createRideRequest — missing entities', () => {
  it('rejects a missing requester without creating a request', async () => {
    const persistence = fakePersistence({
      findRequester: vi.fn().mockResolvedValue(null),
      findRideForRequest: vi.fn().mockResolvedValue(ride),
      findActiveRequest: vi.fn(),
      createRequest: vi.fn(),
    });

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(persistence.createRequest).not.toHaveBeenCalled();
  });

  it('rejects a missing ride without creating a request', async () => {
    const persistence = fakePersistence({
      findRequester: vi.fn().mockResolvedValue(requester),
      findRideForRequest: vi.fn().mockResolvedValue(null),
      findActiveRequest: vi.fn(),
      createRequest: vi.fn(),
    });

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(persistence.createRequest).not.toHaveBeenCalled();
  });
});

describe('createRideRequest — business rules', () => {
  it('rejects a ride creator requesting their own ride', async () => {
    const persistence = happyPersistence();
    const selfRide = { ...ride, creatorId: 'user-1' };
    persistence.findRideForRequest = vi.fn().mockResolvedValue(selfRide);

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    expect(persistence.createRequest).not.toHaveBeenCalled();
  });

  it('rejects a non-requestable ride state', async () => {
    for (const status of [
      RideStatus.DRAFT,
      RideStatus.IN_PROGRESS,
      RideStatus.COMPLETED,
      RideStatus.CANCELLED,
      RideStatus.EXPIRED,
    ]) {
      const persistence = happyPersistence();
      persistence.findRideForRequest = vi
        .fn()
        .mockResolvedValue({ ...ride, status });

      await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
        BusinessRuleError,
      );
      expect(persistence.createRequest).not.toHaveBeenCalled();
    }
  });

  it('rejects a request exceeding currently available seats', async () => {
    const persistence = happyPersistence();
    persistence.findRideForRequest = vi
      .fn()
      .mockResolvedValue({ ...ride, availableSeats: 1 });

    await expect(
      run(persistence, { ...validInput, requestedSeats: 2 }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(persistence.createRequest).not.toHaveBeenCalled();
  });

  it('accepts a request exactly matching available seats', async () => {
    const persistence = happyPersistence();
    persistence.findRideForRequest = vi
      .fn()
      .mockResolvedValue({ ...ride, availableSeats: 2 });

    const result = await run(persistence, {
      ...validInput,
      requestedSeats: 2,
    });
    expect(result.requestedSeats).toBe(2);
  });

  it('rejects a duplicate active request', async () => {
    const persistence = happyPersistence();
    persistence.findActiveRequest = vi
      .fn()
      .mockResolvedValue({ id: 'existing-request' });

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(persistence.createRequest).not.toHaveBeenCalled();
  });

  it('allows a request when no active request exists (e.g. a historical one does)', async () => {
    const persistence = happyPersistence();
    persistence.findActiveRequest = vi.fn().mockResolvedValue(null);

    await expect(run(persistence, validInput)).resolves.toMatchObject({
      status: RideRequestStatus.PENDING,
    });
  });
});

describe('createRideRequest — input validation', () => {
  it('rejects an empty rideId and requesterId before touching persistence', async () => {
    const runTransaction = vi.fn();
    const deps = {
      runTransaction:
        runTransaction as unknown as CreateRideRequestDependencies['runTransaction'],
    };

    await expect(
      createRideRequest({ rideId: '', requesterId: 'user-1' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createRideRequest({ rideId: 'ride-1', requesterId: '   ' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('rejects invalid requestedSeats', async () => {
    const persistence = happyPersistence();
    for (const requestedSeats of [0, -1, 2.5]) {
      await expect(
        run(persistence, { ...validInput, requestedSeats }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(persistence.createRequest).not.toHaveBeenCalled();
    }
  });

  it('rejects a request with an invalid ride state via a structured error', async () => {
    const persistence = happyPersistence();
    persistence.findRideForRequest = vi
      .fn()
      .mockResolvedValue({ ...ride, status: RideStatus.DRAFT });

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      field: 'rideId',
      statusCode: 422,
    });
  });
});

describe('createRideRequest — error translation', () => {
  it('propagates an AppError raised by persistence', async () => {
    const persistence = fakePersistence({
      findRequester: vi.fn().mockResolvedValue(requester),
      findRideForRequest: vi.fn().mockResolvedValue(ride),
      findActiveRequest: vi.fn().mockResolvedValue(null),
      createRequest: vi
        .fn()
        .mockRejectedValue(new NotFoundError('nope', { field: 'rideId' })),
    });

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('translates a unique-constraint race into a ConflictError', async () => {
    const persistence = happyPersistence();
    persistence.createRequest = vi.fn().mockRejectedValue(new Error('P2002'));
    persistence.classifyError = vi.fn(
      (_err: unknown): 'unique' | 'foreign_key' | null => 'unique',
    );

    const promise = run(persistence, validInput);
    await expect(promise).rejects.toBeInstanceOf(ConflictError);
    await expect(promise).rejects.not.toThrow('P2002');
  });

  it('translates a foreign-key race into a NotFoundError', async () => {
    const persistence = happyPersistence();
    persistence.createRequest = vi.fn().mockRejectedValue(new Error('P2003'));
    persistence.classifyError = vi.fn(
      (_err: unknown): 'unique' | 'foreign_key' | null => 'foreign_key',
    );

    await expect(run(persistence, validInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('wraps an unexpected persistence failure without leaking it directly', async () => {
    const persistence = happyPersistence();
    persistence.createRequest = vi
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
