/**
 * Unit tests for the reusable authorization boundary (Phase 3.9).
 *
 * Covers the ownership rules the future API layer will enforce through
 * authenticated identity: creator-only ride operations, requester-only
 * decisions on their own request, own-notification access, and identity
 * isolation (user A can never act as user B).
 */
import { describe, expect, it } from 'vitest';
import { AppError, AuthorizationError } from '../../../lib/errors.js';
import { createAuthenticatedUser } from '../domain/identity.js';
import {
  assertNotificationOwner,
  assertRequestOwner,
  assertRideCreator,
  isSameUser,
} from './authorization.js';

describe('isSameUser', () => {
  it('is true only for the same user id', () => {
    const alice = createAuthenticatedUser('alice');

    expect(isSameUser(alice, 'alice')).toBe(true);
    expect(isSameUser(alice, 'bob')).toBe(false);
  });
});

describe('assertRideCreator (creator-only ride operations)', () => {
  it('allows the ride creator to manage their ride', () => {
    const creator = createAuthenticatedUser('creator-1');

    expect(() =>
      assertRideCreator(creator, 'creator-1', 'ride-1'),
    ).not.toThrow();
  });

  it('rejects any other actor with a generic 403', () => {
    const stranger = createAuthenticatedUser('stranger');

    expect(() => assertRideCreator(stranger, 'creator-1', 'ride-1')).toThrow(
      AuthorizationError,
    );
    try {
      assertRideCreator(stranger, 'creator-1', 'ride-1');
    } catch (err) {
      const error = err as AppError;
      expect(error.statusCode).toBe(403);
      expect(error.expose).toBe(true);
      expect(error.details?.rideId).toBe('ride-1');
    }
  });
});

describe('assertRequestOwner (requester-only decisions)', () => {
  it('allows a user to decide on their own request', () => {
    const requester = createAuthenticatedUser('requester-1');

    expect(() =>
      assertRequestOwner(requester, 'requester-1', 'request-1'),
    ).not.toThrow();
  });

  it('rejects decisions on another user request', () => {
    const other = createAuthenticatedUser('other-user');

    expect(() => assertRequestOwner(other, 'requester-1', 'request-1')).toThrow(
      AuthorizationError,
    );
  });
});

describe('assertNotificationOwner (own-notification access)', () => {
  it('allows a recipient to access their own notification', () => {
    const recipient = createAuthenticatedUser('recipient-1');

    expect(() =>
      assertNotificationOwner(recipient, 'recipient-1', 'notification-1'),
    ).not.toThrow();
  });

  it('rejects access to another user notification', () => {
    const stranger = createAuthenticatedUser('stranger');

    expect(() =>
      assertNotificationOwner(stranger, 'recipient-1', 'notification-1'),
    ).toThrow(AuthorizationError);
  });
});

describe('identity isolation', () => {
  it('user A can never act as user B across any guard', () => {
    const alice = createAuthenticatedUser('alice');
    const bob = createAuthenticatedUser('bob');

    expect(() => assertRideCreator(alice, bob.userId, 'ride-1')).toThrow(
      AuthorizationError,
    );
    expect(() => assertRequestOwner(alice, bob.userId, 'request-1')).toThrow(
      AuthorizationError,
    );
    expect(() =>
      assertNotificationOwner(alice, bob.userId, 'notification-1'),
    ).toThrow(AuthorizationError);
  });
});
