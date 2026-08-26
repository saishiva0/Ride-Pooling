import { describe, expect, it } from 'vitest';
import {
  MobileError,
  apiErrorFromBody,
  mobileErrorMessage,
  toMobileError,
} from './errors';

describe('apiErrorFromBody', () => {
  it('maps each shared error code to the documented kind', () => {
    const cases: Array<[string, string]> = [
      ['VALIDATION_ERROR', 'validation'],
      ['AUTHENTICATION_ERROR', 'authentication'],
      ['AUTHORIZATION_ERROR', 'authorization'],
      ['NOT_FOUND', 'not-found'],
      ['CONFLICT', 'conflict'],
      ['BUSINESS_RULE_VIOLATION', 'business-rule'],
      ['RATE_LIMITED', 'rate-limited'],
      ['EXTERNAL_SERVICE_ERROR', 'external-service'],
      ['INTERNAL_ERROR', 'server'],
    ];
    for (const [code, kind] of cases) {
      const error = apiErrorFromBody({
        code: code as never,
        message: `${code} message`,
      });
      expect(error.kind, code).toBe(kind);
      expect(error.code).toBe(code);
      expect(error.message).toBe(`${code} message`);
    }
  });

  it('preserves field and details from the backend envelope', () => {
    const error = apiErrorFromBody({
      code: 'VALIDATION_ERROR',
      message: 'latitude must be a finite number between -90 and 90',
      field: 'pickup.latitude',
      details: { latitude: 999 },
    });
    expect(error.field).toBe('pickup.latitude');
    expect(error.details).toEqual({ latitude: 999 });
  });

  it('never leaks internals into the payload', () => {
    const error = apiErrorFromBody({
      code: 'INTERNAL_ERROR',
      message: 'Unexpected failure',
    });
    // Only the safe backend fields are carried; no stack/file path content.
    expect(error.details).toBeUndefined();
    expect(error.field).toBeUndefined();
    expect(error.message).toBe('Unexpected failure');
    expect(error.message).not.toContain('.ts');
    expect(error.message).not.toContain('node_modules');
  });

  it('carries the HTTP status when provided', () => {
    const error = apiErrorFromBody(
      { code: 'NOT_FOUND', message: 'missing' },
      404,
    );
    expect(error.statusCode).toBe(404);
  });
});

describe('toMobileError', () => {
  it('passes an existing MobileError through unchanged', () => {
    const original = new MobileError('conflict', 'duplicate request');
    expect(toMobileError(original)).toBe(original);
  });

  it('classifies an AbortError as a timeout', () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    const error = toMobileError(abortError);
    expect(error.kind).toBe('timeout');
  });

  it('classifies a TypeError (fetch failure) as a network error without leaking the message', () => {
    const error = toMobileError(new TypeError('fetch failed'));
    expect(error.kind).toBe('network');
    expect(error.message).not.toContain('fetch failed');
  });

  it('classifies anything else as unknown without leaking internals', () => {
    const error = toMobileError(new Error('secret internal detail'));
    expect(error.kind).toBe('unknown');
    expect(error.message).toBe('Unexpected error');
  });

  it('classifies non-Error values as unknown', () => {
    expect(toMobileError('oops').kind).toBe('unknown');
    expect(toMobileError(undefined).kind).toBe('unknown');
  });
});

describe('mobileErrorMessage', () => {
  it('surfaces backend-authored messages for validation and business-rule errors', () => {
    const validation = new MobileError(
      'validation',
      'latitude must be between -90 and 90',
    );
    expect(mobileErrorMessage(validation)).toBe(
      'latitude must be between -90 and 90',
    );
    const business = new MobileError(
      'business-rule',
      'Ride is not open to requests',
    );
    expect(mobileErrorMessage(business)).toBe('Ride is not open to requests');
  });

  it('maps every other kind to a stable generic message', () => {
    const cases: Array<[string, string]> = [
      [
        'network',
        'Network request failed. Check your connection and try again.',
      ],
      ['timeout', 'The request timed out. Try again.'],
      ['authentication', 'Authentication failed. Sign in again.'],
      ['authorization', 'You do not have permission to do this.'],
      ['not-found', 'Not found.'],
      [
        'conflict',
        'This action conflicts with the current state. Refresh and try again.',
      ],
      ['rate-limited', 'Too many requests. Try again shortly.'],
      ['external-service', 'A service is temporarily unavailable. Try again.'],
      ['server', 'The server encountered an error. Try again.'],
      [
        'permission-denied',
        'Location permission was denied. You can still enter coordinates manually.',
      ],
      [
        'permission-unavailable',
        'Location permission is not available on this device. You can still enter coordinates manually.',
      ],
      [
        'location-unavailable',
        'Your current location could not be determined. You can still enter coordinates manually.',
      ],
      ['unknown', 'Something went wrong. Try again.'],
    ];
    for (const [kind, expected] of cases) {
      const error = new MobileError(kind as never, 'raw internal detail');
      expect(mobileErrorMessage(error), kind).toBe(expected);
      expect(mobileErrorMessage(error)).not.toContain('raw internal detail');
    }
  });

  it('never leaks backend internals for server errors', () => {
    const error = apiErrorFromBody(
      { code: 'INTERNAL_ERROR', message: 'Failed at /src/db.ts:42' },
      500,
    );
    expect(mobileErrorMessage(error)).not.toContain('/src/db.ts');
    expect(mobileErrorMessage(error)).not.toContain('node_modules');
  });
});
