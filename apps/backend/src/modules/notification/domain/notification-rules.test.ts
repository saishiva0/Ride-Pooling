import { describe, expect, it } from 'vitest';
import { NotificationType } from '@prisma/client';
import {
  isNotificationType,
  isSupportedNotificationType,
  SUPPORTED_NOTIFICATION_TYPES,
} from './notification-rules.js';

describe('SUPPORTED_NOTIFICATION_TYPES', () => {
  it('contains the seven ride events plus chat messages', () => {
    expect(SUPPORTED_NOTIFICATION_TYPES).toEqual([
      NotificationType.RIDE_REQUESTED,
      NotificationType.REQUEST_ACCEPTED,
      NotificationType.REQUEST_REJECTED,
      NotificationType.REQUEST_CANCELLED,
      NotificationType.RIDE_CANCELLED,
      NotificationType.RIDE_EXPIRED,
      NotificationType.RIDE_CONFIRMED,
      NotificationType.CHAT_MESSAGE,
    ]);
  });
  it('every supported type is an enum member', () => {
    for (const type of SUPPORTED_NOTIFICATION_TYPES)
      expect(isNotificationType(type)).toBe(true);
  });
  it('does not include unrelated future ride events', () => {
    expect(SUPPORTED_NOTIFICATION_TYPES).not.toContain(
      NotificationType.RIDE_STARTED,
    );
    expect(SUPPORTED_NOTIFICATION_TYPES).not.toContain(
      NotificationType.RIDE_CREATED,
    );
  });
});

describe('isNotificationType', () => {
  it('accepts every enum value', () => {
    for (const type of Object.values(NotificationType))
      expect(isNotificationType(type)).toBe(true);
  });
  it('rejects invalid values', () => {
    expect(isNotificationType('RIDE_STARTED_NOW')).toBe(false);
    expect(isNotificationType('')).toBe(false);
    expect(isNotificationType(undefined)).toBe(false);
    expect(isNotificationType(null)).toBe(false);
    expect(isNotificationType(42)).toBe(false);
    expect(isNotificationType({})).toBe(false);
  });
});

describe('isSupportedNotificationType', () => {
  it('accepts chat and every other supported type', () => {
    for (const type of SUPPORTED_NOTIFICATION_TYPES)
      expect(isSupportedNotificationType(type)).toBe(true);
  });
  it('rejects enum values not wired here', () => {
    expect(isSupportedNotificationType(NotificationType.RIDE_STARTED)).toBe(
      false,
    );
    expect(isSupportedNotificationType(NotificationType.RIDE_CREATED)).toBe(
      false,
    );
  });
});
