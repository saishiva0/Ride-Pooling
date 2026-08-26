/**
 * Unit tests for the Phase 3.8 notification domain rules.
 *
 * Pure, deterministic, no database: verifies the supported-type catalogue
 * (exactly the seven Ride Engine events wired this phase), the enum-membership
 * guard, and the supported-type guard.
 */
import { describe, expect, it } from 'vitest';
import { NotificationType } from '@prisma/client';
import {
  isNotificationType,
  isSupportedNotificationType,
  SUPPORTED_NOTIFICATION_TYPES,
} from './notification-rules.js';

describe('SUPPORTED_NOTIFICATION_TYPES — Phase 3.8/3.21 catalogue', () => {
  it('contains exactly the seven Ride Engine events wired in this phase', () => {
    expect(SUPPORTED_NOTIFICATION_TYPES).toEqual([
      NotificationType.RIDE_REQUESTED,
      NotificationType.REQUEST_ACCEPTED,
      NotificationType.REQUEST_REJECTED,
      NotificationType.REQUEST_CANCELLED,
      NotificationType.RIDE_CANCELLED,
      NotificationType.RIDE_EXPIRED,
      NotificationType.RIDE_CONFIRMED,
    ]);
  });

  it('every supported type is a member of the NotificationType enum', () => {
    for (const type of SUPPORTED_NOTIFICATION_TYPES) {
      expect(isNotificationType(type)).toBe(true);
    }
  });

  it('does not include events whose Ride Engine operations are not implemented yet', () => {
    // RIDE_STARTED is a valid enum value but its operation is a later phase.
    expect(SUPPORTED_NOTIFICATION_TYPES).not.toContain(
      NotificationType.RIDE_STARTED,
    );
    expect(SUPPORTED_NOTIFICATION_TYPES).not.toContain(
      NotificationType.RIDE_CREATED,
    );
  });
});

describe('isNotificationType', () => {
  it('accepts every NotificationType enum value', () => {
    for (const type of Object.values(NotificationType)) {
      expect(isNotificationType(type)).toBe(true);
    }
  });

  it('rejects non-enum strings', () => {
    expect(isNotificationType('RIDE_STARTED_NOW')).toBe(false);
    expect(isNotificationType('')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isNotificationType(undefined)).toBe(false);
    expect(isNotificationType(null)).toBe(false);
    expect(isNotificationType(42)).toBe(false);
    expect(isNotificationType({})).toBe(false);
  });
});

describe('isSupportedNotificationType', () => {
  it('accepts each supported type', () => {
    for (const type of SUPPORTED_NOTIFICATION_TYPES) {
      expect(isSupportedNotificationType(type)).toBe(true);
    }
  });

  it('rejects enum values that are valid but not wired this phase', () => {
    expect(isSupportedNotificationType(NotificationType.RIDE_STARTED)).toBe(
      false,
    );
    expect(isSupportedNotificationType(NotificationType.RIDE_CREATED)).toBe(
      false,
    );
  });
});
