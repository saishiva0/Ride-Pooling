/**
 * E.164 phone parsing (OD-005 — resolved Phase 3.18: phone + OTP).
 *
 * The ONLY phone normalization is `normalizePhone` (Phase 3.9); this module
 * layers the E.164 rules approved by OD-005 on top of it:
 *
 *   - A number with a leading `+` must be a valid international number
 *     (`+` followed by 1–15 digits, per the E.164 standard) and is preserved.
 *   - A number WITHOUT `+` is treated as a national number in the default
 *     country (India, `+91`): leading zeros are stripped and the remaining
 *     national number must be exactly 10 digits.
 *
 * The result is always `+<country><national>` or `+<international>` — a single
 * canonical shape used for storage, lookups, and the unique `User.phone`.
 * `toProviderPhone` converts it to the MSG91 wire format (no `+`).
 */
import { ValidationError } from '../../../lib/errors.js';
import { normalizePhone } from './identifiers.js';

/** Default country code (India-focused V1 per OD-005). */
export const DEFAULT_COUNTRY_CODE = '91';

/** E.164 maximum total length (without `+`): 15 digits. */
export const E164_MAX_DIGITS = 15;

/** Length of a national number in the default country. */
export const DEFAULT_NATIONAL_LENGTH = 10;

/** The canonical `+...` form the backend stores and compares phones by. */
export type E164Phone = string & { readonly __brand: unique symbol };

function invalidPhone() {
  return new ValidationError('phone must be a valid phone number', {
    field: 'phone',
  });
}

/**
 * Parses and canonicalizes a phone to E.164 (`+...`). Throws
 * `ValidationError` (400) for anything that is not a well-formed number.
 */
export function parseE164Phone(
  value: unknown,
  opts: { countryCode?: string } = {},
): E164Phone {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError('phone is required', { field: 'phone' });
  }
  const countryCode = opts.countryCode ?? DEFAULT_COUNTRY_CODE;
  const normalized = normalizePhone(value);

  const hasPlus = normalized.startsWith('+');
  const digits = hasPlus ? normalized.slice(1) : normalized;

  if (!/^\d+$/.test(digits)) {
    throw invalidPhone();
  }

  if (hasPlus) {
    if (digits.length < 1 || digits.length > E164_MAX_DIGITS) {
      throw invalidPhone();
    }
    return `+${digits}` as E164Phone;
  }

  const national = digits.replace(/^0+/, '');
  if (national.length !== DEFAULT_NATIONAL_LENGTH) {
    throw invalidPhone();
  }
  return `+${countryCode}${national}` as E164Phone;
}

/** Converts a canonical E.164 phone to the MSG91 wire format (no `+`). */
export function toProviderPhone(phone: E164Phone): string {
  return phone.replace(/^\+/, '');
}
