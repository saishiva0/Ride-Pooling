/**
 * Unit tests for the centralized Phase 3.8 notification content mapping.
 *
 * Pure, deterministic, no database: verifies the canonical title/body for
 * every supported type, the requester-name personalization of the
 * RIDE_REQUESTED body, and that unsupported enum values are rejected rather
 * than fabricated.
 */
import { describe, expect, it } from 'vitest';
import { NotificationType } from '@prisma/client';
import { ValidationError } from '../../../lib/errors.js';
import { notificationContent } from './notification-content.js';

describe('notificationContent — supported types', () => {
  it('maps RIDE_REQUESTED to the new-ride-request title and body', () => {
    expect(notificationContent(NotificationType.RIDE_REQUESTED)).toEqual({
      title: 'New ride request',
      body: 'A participant requested to join your ride',
    });
  });

  it('personalizes the RIDE_REQUESTED body with the requester name when supplied', () => {
    expect(
      notificationContent(NotificationType.RIDE_REQUESTED, {
        requesterName: 'Riya',
      }),
    ).toEqual({
      title: 'New ride request',
      body: 'Riya requested to join your ride',
    });
  });

  it('maps REQUEST_ACCEPTED to the accepted title and body', () => {
    expect(notificationContent(NotificationType.REQUEST_ACCEPTED)).toEqual({
      title: 'Ride request accepted',
      body: 'Your ride request was accepted',
    });
  });

  it('maps REQUEST_REJECTED to the rejected title and body', () => {
    expect(notificationContent(NotificationType.REQUEST_REJECTED)).toEqual({
      title: 'Ride request rejected',
      body: 'Your ride request was declined',
    });
  });

  it('maps REQUEST_CANCELLED to the cancelled title and body', () => {
    expect(notificationContent(NotificationType.REQUEST_CANCELLED)).toEqual({
      title: 'Ride request cancelled',
      body: 'A participant cancelled their ride request',
    });
  });

  it('maps RIDE_CANCELLED to the cancelled title and body', () => {
    expect(notificationContent(NotificationType.RIDE_CANCELLED)).toEqual({
      title: 'Ride cancelled',
      body: 'A ride you joined was cancelled',
    });
  });

  it('maps RIDE_EXPIRED to the expired title and body', () => {
    expect(notificationContent(NotificationType.RIDE_EXPIRED)).toEqual({
      title: 'Ride expired',
      body: 'A ride you joined has expired',
    });
  });

  it('maps RIDE_CONFIRMED to the confirmed title and body', () => {
    expect(notificationContent(NotificationType.RIDE_CONFIRMED)).toEqual({
      title: 'Ride confirmed',
      body: 'Your ride is confirmed',
    });
  });

  it('is deterministic across calls', () => {
    const first = notificationContent(NotificationType.RIDE_CONFIRMED);
    const second = notificationContent(NotificationType.RIDE_CONFIRMED);
    expect(first).toEqual(second);
  });
});

describe('notificationContent — unsupported types', () => {
  it.each([
    NotificationType.RIDE_CREATED,
    NotificationType.RIDE_PUBLISHED,
    NotificationType.RIDE_UPDATED,
    NotificationType.RIDE_STARTED,
    NotificationType.RIDE_COMPLETED,
  ])('throws ValidationError for %s (not wired this phase)', (type) => {
    const promise = () => notificationContent(type);
    expect(promise).toThrow(ValidationError);
    expect(promise).toThrowError(
      expect.objectContaining({ statusCode: 400, field: 'type' }),
    );
  });
});
