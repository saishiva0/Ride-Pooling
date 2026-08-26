/**
 * Provider-independent user identifier normalization (Phase 3.9).
 *
 * Whatever the authentication mechanism (OD-005 resolved to phone + OTP in
 * Phase 3.18), the boundary must compare identifiers consistently or the same
 * person can end up with two accounts ("User" vs "user", " +91 98000 00001 "
 * vs "+919800000001"). These helpers normalize BEFORE storage and lookup so
 * uniqueness constraints (`User.phone` / `User.email` are @unique) behave
 * predictably.
 *
 * Deliberately minimal: full E.164 phone formatting lives in
 * `domain/phone.ts` (OD-005), not here.
 */
import { ValidationError } from '../../../lib/errors.js';

/** Trims and lowercases an email so lookups are case-insensitive. */
export function normalizeEmail(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError('email is required', { field: 'email' });
  }
  return value.trim().toLowerCase();
}

/**
 * Trims a phone and strips common visual separators (spaces, dashes,
 * parentheses, dots). Keeps the leading `+`. Full E.164 validation is left
 * to the approved auth method.
 */
export function normalizePhone(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError('phone is required', { field: 'phone' });
  }
  return value.trim().replace(/[\s\-().]/g, '');
}
