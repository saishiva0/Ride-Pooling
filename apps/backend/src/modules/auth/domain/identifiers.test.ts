/**
 * Unit tests for identifier normalization (Phase 3.9).
 *
 * Whatever OD-005 resolves to, identifiers must be normalized consistently
 * before storage/lookup so the same person cannot register twice
 * ("User" vs "user", "+91 98000 00001" vs "+919800000001").
 */
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../lib/errors.js';
import { normalizeEmail, normalizePhone } from './identifiers.js';

describe('normalizeEmail', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  meera.iyer@example.dev  ')).toBe(
      'meera.iyer@example.dev',
    );
  });

  it('lowercases for case-insensitive comparison', () => {
    expect(normalizeEmail('Meera.Iyer@Example.Dev')).toBe(
      'meera.iyer@example.dev',
    );
  });

  it('rejects blank or non-string values', () => {
    expect(() => normalizeEmail('')).toThrow(ValidationError);
    expect(() => normalizeEmail('   ')).toThrow(ValidationError);
    expect(() => normalizeEmail(42 as unknown as string)).toThrow(
      ValidationError,
    );
  });
});

describe('normalizePhone', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizePhone('  +919800000001  ')).toBe('+919800000001');
  });

  it('strips common visual separators', () => {
    expect(normalizePhone('+91 98000 00001')).toBe('+919800000001');
    expect(normalizePhone('+91-98000-00001')).toBe('+919800000001');
    expect(normalizePhone('+91 (98000) 00001')).toBe('+919800000001');
    expect(normalizePhone('+91.98000.00001')).toBe('+919800000001');
  });

  it('keeps the leading plus sign', () => {
    expect(normalizePhone('+1 415 555 0132')).toBe('+14155550132');
  });

  it('rejects blank or non-string values', () => {
    expect(() => normalizePhone('')).toThrow(ValidationError);
    expect(() => normalizePhone('   ')).toThrow(ValidationError);
    expect(() => normalizePhone(null as unknown as string)).toThrow(
      ValidationError,
    );
  });
});
