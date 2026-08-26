/**
 * Unit tests for E.164 phone parsing (OD-005 — Phase 3.18).
 */
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../lib/errors.js';
import {
  DEFAULT_COUNTRY_CODE,
  parseE164Phone,
  toProviderPhone,
} from './phone.js';

describe('parseE164Phone', () => {
  it('keeps a valid international number with a leading +', () => {
    expect(parseE164Phone('+919800000001')).toBe('+919800000001');
    expect(parseE164Phone('+14155550132')).toBe('+14155550132');
  });

  it('normalizes separators before parsing (reuses normalizePhone)', () => {
    expect(parseE164Phone('+91 98000 00001')).toBe('+919800000001');
    expect(parseE164Phone('+91-98000-00001')).toBe('+919800000001');
    expect(parseE164Phone('  +91 (98000) 00001  ')).toBe('+919800000001');
  });

  it('treats a bare 10-digit national number as the default country code', () => {
    expect(parseE164Phone('9876543210')).toBe(
      `+${DEFAULT_COUNTRY_CODE}9876543210`,
    );
  });

  it('strips a leading trunk zero from a national number', () => {
    expect(parseE164Phone('09876543210')).toBe('+919876543210');
  });

  it('rejects blank and non-string input', () => {
    expect(() => parseE164Phone('')).toThrow(ValidationError);
    expect(() => parseE164Phone('   ')).toThrow(ValidationError);
    expect(() => parseE164Phone(42 as unknown as string)).toThrow(
      ValidationError,
    );
  });

  it('rejects malformed numbers', () => {
    expect(() => parseE164Phone('+')).toThrow(ValidationError);
    expect(() => parseE164Phone('+abc123')).toThrow(ValidationError);
    expect(() => parseE164Phone('987654321')).toThrow(ValidationError);
    expect(() => parseE164Phone('1234567890123456')).toThrow(ValidationError);
    expect(() => parseE164Phone('+1234567890123456')).toThrow(ValidationError);
    expect(() => parseE164Phone('98765 43210 extra')).toThrow(ValidationError);
  });

  it('honors an explicit country code option for national numbers', () => {
    expect(parseE164Phone('4155550132', { countryCode: '1' })).toBe(
      '+14155550132',
    );
  });
});

describe('toProviderPhone', () => {
  it('strips the leading + for the MSG91 wire format', () => {
    expect(toProviderPhone(parseE164Phone('+919800000001'))).toBe(
      '919800000001',
    );
    expect(toProviderPhone(parseE164Phone('9876543210'))).toBe('919876543210');
  });
});
