/**
 * Notification tap navigation tests (Phase 3.23).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { NotificationType } from '@ridepool/shared';
import { ROUTES } from '../navigation/routes.js';
import type { AppNavigation } from '../navigation/app-navigator.js';
import {
  getNotificationNavigationTarget,
  navigateFromNotification,
  setNotificationNavigationRef,
  validateNotificationData,
} from './navigation.js';

afterEach(() => {
  setNotificationNavigationRef(null);
  vi.restoreAllMocks();
});

const ALL_TYPES: NotificationType[] = [
  'RIDE_REQUESTED',
  'REQUEST_ACCEPTED',
  'REQUEST_REJECTED',
  'REQUEST_CANCELLED',
  'RIDE_CANCELLED',
  'RIDE_EXPIRED',
  'RIDE_CONFIRMED',
] as NotificationType[];

describe('getNotificationNavigationTarget', () => {
  it.each(ALL_TYPES)('routes %s to the notifications feed', (type) => {
    const target = getNotificationNavigationTarget({ type, rideId: 'ride-1' });
    expect(target).toEqual({ route: ROUTES.NOTIFICATIONS, params: {} });
  });

  it('routes an unrecognized type to the notifications feed too (safe fallback)', () => {
    const target = getNotificationNavigationTarget({
      type: 'SOMETHING_UNKNOWN' as NotificationType,
    });
    expect(target.route).toBe(ROUTES.NOTIFICATIONS);
  });
});

describe('validateNotificationData', () => {
  it('accepts a payload with a non-empty string type', () => {
    expect(validateNotificationData({ type: 'RIDE_CONFIRMED' })).toBe(true);
  });

  it.each([null, undefined, 'a string', 42, {}, { type: '' }, { type: 5 }])(
    'rejects malformed payload %j',
    (data) => {
      expect(validateNotificationData(data)).toBe(false);
    },
  );
});

describe('navigateFromNotification', () => {
  function fakeNavigationRef() {
    const navigate = vi.fn();
    const ref = { current: { navigate } as unknown as AppNavigation };
    return { ref, navigate };
  }

  it('does nothing when no navigation ref has been set', async () => {
    await expect(
      navigateFromNotification({ type: 'RIDE_CONFIRMED' }),
    ).resolves.toBeUndefined();
  });

  it('navigates to the notifications feed for valid data', async () => {
    const { ref, navigate } = fakeNavigationRef();
    setNotificationNavigationRef(ref);

    await navigateFromNotification({
      type: 'RIDE_CONFIRMED',
      rideId: 'ride-1',
    });

    expect(navigate).toHaveBeenCalledWith(ROUTES.NOTIFICATIONS);
  });

  it('still navigates safely (with a warning) for malformed data', async () => {
    const { ref, navigate } = fakeNavigationRef();
    setNotificationNavigationRef(ref);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await navigateFromNotification({ nonsense: true });

    expect(navigate).toHaveBeenCalledWith(ROUTES.NOTIFICATIONS);
    expect(warn).toHaveBeenCalled();
  });

  it('never throws even if navigate itself throws', async () => {
    const navigate = vi.fn(() => {
      throw new Error('navigator not ready');
    });
    setNotificationNavigationRef({
      current: { navigate } as unknown as AppNavigation,
    });

    await expect(
      navigateFromNotification({ type: 'RIDE_CONFIRMED' }),
    ).resolves.toBeUndefined();
  });
});
