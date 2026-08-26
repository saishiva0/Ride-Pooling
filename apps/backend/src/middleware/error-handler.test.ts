/**
 * Unit tests for the centralized error handler and not-found middleware
 * (Phase 3.10).
 *
 * Verifies the AppError → HTTP mapping table, the 500-safe behavior for
 * unexpected errors (no raw Prisma/database details or stack traces reach
 * the response), stack exposure only in development, and the corrected 404
 * for unknown routes.
 */
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  ExternalServiceError,
  InternalError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { createErrorHandler, notFoundHandler } from './error-handler.js';

function makeRes() {
  const json = vi.fn();
  const res = {
    status: vi.fn(() => ({ json })),
    locals: { requestId: 'req-test' },
  } as unknown as Response;
  return { res, json };
}

function callHandler(err: unknown, exposeStack = false) {
  const { res, json } = makeRes();
  const req = { path: '/api/v1/test', method: 'POST' } as unknown as Request;
  const handler = createErrorHandler({
    logger: createLogger({ level: 'silent', pretty: false }),
    exposeStack,
  });
  handler(err, req, res, vi.fn() as unknown as NextFunction);
  return { res, json };
}

describe('createErrorHandler — AppError mapping', () => {
  // expose=false errors (ExternalServiceError/InternalError) render the
  // generic message; expose=true errors render their own message.
  const cases: Array<[string, Error, number, string, string]> = [
    [
      'ValidationError',
      new ValidationError('bad input'),
      400,
      'VALIDATION_ERROR',
      'bad input',
    ],
    [
      'AuthenticationError',
      new AuthenticationError('Authentication failed'),
      401,
      'AUTHENTICATION_ERROR',
      'Authentication failed',
    ],
    [
      'AuthorizationError',
      new AuthorizationError('forbidden'),
      403,
      'AUTHORIZATION_ERROR',
      'forbidden',
    ],
    [
      'NotFoundError',
      new NotFoundError('missing'),
      404,
      'NOT_FOUND',
      'missing',
    ],
    [
      'ConflictError',
      new ConflictError('conflict'),
      409,
      'CONFLICT',
      'conflict',
    ],
    [
      'BusinessRuleError',
      new BusinessRuleError('rule violated'),
      422,
      'BUSINESS_RULE_VIOLATION',
      'rule violated',
    ],
    [
      'RateLimitError',
      new RateLimitError('slow down'),
      429,
      'RATE_LIMITED',
      'slow down',
    ],
    [
      'ExternalServiceError',
      new ExternalServiceError('provider down'),
      502,
      'EXTERNAL_SERVICE_ERROR',
      'Internal server error',
    ],
    [
      'InternalError',
      new InternalError('boom'),
      500,
      'INTERNAL_ERROR',
      'Internal server error',
    ],
  ];

  it.each(cases)(
    'maps %s to its status and code',
    (_name, err, status, code, message) => {
      const { res, json } = callHandler(err);

      expect(res.status).toHaveBeenCalledWith(status);
      expect(json).toHaveBeenCalledWith({
        error: { code, message },
      });
    },
  );

  it('includes field and details when present', () => {
    const err = new ValidationError('bad seats', {
      field: 'totalSeats',
      details: { totalSeats: 0 },
    });
    const { json } = callHandler(err);

    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'bad seats',
        field: 'totalSeats',
        details: { totalSeats: 0 },
      },
    });
  });
});

describe('createErrorHandler — 500-safe behavior', () => {
  it('never leaks a raw error message or stack to the response', () => {
    const { json } = callHandler(
      new Error('secrets: /c:/users/me/db.js password=topsecret'),
    );

    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
  });

  it('never leaks Prisma errors to the response', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`phone`)',
      { code: 'P2002', clientVersion: '6.19.3' },
    );
    const { json } = callHandler(prismaError);

    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
  });

  it('exposes a stack only when explicitly configured (development)', () => {
    const err = new Error('boom');
    const { json } = callHandler(err, true);

    const payload = json.mock.calls[0]?.[0] as {
      error: { message: string };
      stack: string;
    };
    expect(payload.error.message).toBe('Internal server error');
    expect(payload.stack).toBeDefined();
  });

  it('does not expose a stack for expose=true AppErrors even in development', () => {
    const err = new NotFoundError('missing');
    const { json } = callHandler(err, true);

    const payload = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.stack).toBeUndefined();
  });
});

describe('notFoundHandler', () => {
  it('produces a 404 NotFoundError for unmatched routes', () => {
    const req = {
      method: 'GET',
      path: '/api/v1/nope',
    } as unknown as Request;
    const next = vi.fn();

    notFoundHandler(req, {} as Response, next);

    const err = next.mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain('GET /api/v1/nope');
  });
});
