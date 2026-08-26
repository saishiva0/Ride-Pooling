import { describe, expect, it, vi } from 'vitest';
import { MobileError } from '../../api/errors';
import { renderAndSettle, extractText, press } from '../../../tests/render';
import {
  fakeNavigation,
  fakeRideApi,
  notification,
} from '../../../tests/fixtures';
import type { RideNotificationList } from '../../ride/types';
import { NotificationsScreen } from './notifications-screen';

describe('NotificationsScreen', () => {
  it('shows a loading state while the list is unresolved', async () => {
    const rideApi = fakeRideApi({
      listNotifications: vi.fn(
        async () => new Promise<RideNotificationList>(() => {}),
      ),
    });
    const root = await renderAndSettle(
      <NotificationsScreen navigation={fakeNavigation()} rideApi={rideApi} />,
    );
    expect(extractText(root.toJSON())).toContain('Loading notifications…');
  });

  it('shows a normalized error and retries', async () => {
    const rideApi = fakeRideApi({
      listNotifications: vi
        .fn()
        .mockRejectedValueOnce(
          new MobileError('server', 'boom', { cause: new Error('down') }),
        )
        .mockResolvedValueOnce({
          notifications: [],
          unreadCount: 0,
          hasMore: false,
        }),
    });
    const root = await renderAndSettle(
      <NotificationsScreen navigation={fakeNavigation()} rideApi={rideApi} />,
    );
    expect(extractText(root.toJSON())).toContain(
      'The server encountered an error. Try again.',
    );
    await press(root, { accessibilityLabel: 'Try again' });
    expect(extractText(root.toJSON())).toContain('No notifications yet.');
  });

  it('shows an empty state when there are no notifications', async () => {
    const rideApi = fakeRideApi({
      listNotifications: vi.fn(async () => ({
        notifications: [],
        unreadCount: 0,
        hasMore: false,
      })),
    });
    const root = await renderAndSettle(
      <NotificationsScreen navigation={fakeNavigation()} rideApi={rideApi} />,
    );
    expect(extractText(root.toJSON())).toContain('No notifications yet.');
  });

  it('lists notifications with the unread count', async () => {
    const rideApi = fakeRideApi({
      listNotifications: vi.fn(async () => ({
        notifications: [
          notification({
            id: 'notification-1',
            type: 'REQUEST_ACCEPTED',
            title: 'Ride request accepted',
            body: 'Your ride request was accepted',
            read: false,
            rideId: 'ride-1',
            requestId: 'request-1',
          }),
          notification({
            id: 'notification-2',
            type: 'RIDE_CONFIRMED',
            title: 'Ride confirmed',
            read: true,
            rideId: null,
            requestId: null,
          }),
        ],
        unreadCount: 1,
        hasMore: false,
      })),
    });
    const root = await renderAndSettle(
      <NotificationsScreen navigation={fakeNavigation()} rideApi={rideApi} />,
    );
    const text = extractText(root.toJSON());
    expect(text).toContain('1 unread');
    expect(text).toContain('Ride request accepted');
    expect(text).toContain('Your ride request was accepted');
    expect(text).toContain('· unread');
    expect(text).toContain('Ride confirmed');
  });

  it('marks all notifications read', async () => {
    const rideApi = fakeRideApi({
      listNotifications: vi.fn(async () => ({
        notifications: [
          notification({
            id: 'notification-1',
            type: 'RIDE_CONFIRMED',
            title: 'Ride confirmed',
            read: false,
            rideId: null,
            requestId: null,
          }),
        ],
        unreadCount: 1,
        hasMore: false,
      })),
      markAllNotificationsRead: vi.fn(async () => ({ updatedCount: 1 })),
    });
    const root = await renderAndSettle(
      <NotificationsScreen navigation={fakeNavigation()} rideApi={rideApi} />,
    );
    await press(root, { accessibilityLabel: 'Mark all read' });
    expect(rideApi.markAllNotificationsRead).toHaveBeenCalledOnce();
    const text = extractText(root.toJSON());
    expect(text).toContain('0 unread');
    expect(text).not.toContain('· unread');
  });

  it('marks a single notification read on tap', async () => {
    const rideApi = fakeRideApi({
      listNotifications: vi.fn(async () => ({
        notifications: [
          notification({
            id: 'notification-1',
            type: 'RIDE_CONFIRMED',
            title: 'Ride confirmed',
            read: false,
            rideId: null,
            requestId: null,
          }),
        ],
        unreadCount: 1,
        hasMore: false,
      })),
      markNotificationRead: vi.fn(async ({ notificationId }) =>
        notification({
          id: notificationId,
          type: 'RIDE_CONFIRMED',
          title: 'Ride confirmed',
          read: true,
          readAt: new Date('2026-08-18T11:00:00.000Z'),
          rideId: null,
          requestId: null,
        }),
      ),
    });
    const root = await renderAndSettle(
      <NotificationsScreen navigation={fakeNavigation()} rideApi={rideApi} />,
    );
    await press(root, { accessibilityLabel: 'Notification: Ride confirmed' });
    expect(rideApi.markNotificationRead).toHaveBeenCalledWith({
      notificationId: 'notification-1',
    });
    const text = extractText(root.toJSON());
    expect(text).toContain('0 unread');
    expect(text).not.toContain('· unread');
  });

  it('accepts a ride request from a RIDE_REQUESTED notification', async () => {
    const rideApi = fakeRideApi({
      listNotifications: vi.fn(async () => ({
        notifications: [
          notification({
            id: 'notification-1',
            type: 'RIDE_REQUESTED',
            title: 'New ride request',
            body: 'Bo requested to join your ride',
            read: false,
            rideId: 'ride-1',
            requestId: 'request-1',
          }),
        ],
        unreadCount: 1,
        hasMore: false,
      })),
    });
    const root = await renderAndSettle(
      <NotificationsScreen navigation={fakeNavigation()} rideApi={rideApi} />,
    );
    await press(root, { accessibilityLabel: 'Accept request' });
    expect(rideApi.acceptRequest).toHaveBeenCalledWith({
      rideId: 'ride-1',
      requestId: 'request-1',
    });
    expect(extractText(root.toJSON())).toContain('Request accepted.');
  });

  it('rejects a ride request from a RIDE_REQUESTED notification', async () => {
    const rideApi = fakeRideApi({
      listNotifications: vi.fn(async () => ({
        notifications: [
          notification({
            id: 'notification-1',
            type: 'RIDE_REQUESTED',
            title: 'New ride request',
            read: false,
            rideId: 'ride-1',
            requestId: 'request-1',
          }),
        ],
        unreadCount: 1,
        hasMore: false,
      })),
    });
    const root = await renderAndSettle(
      <NotificationsScreen navigation={fakeNavigation()} rideApi={rideApi} />,
    );
    await press(root, { accessibilityLabel: 'Reject request' });
    expect(rideApi.rejectRequest).toHaveBeenCalledWith({
      rideId: 'ride-1',
      requestId: 'request-1',
    });
    expect(extractText(root.toJSON())).toContain('Request rejected.');
  });

  it('shows a normalized error when a decision fails', async () => {
    const rideApi = fakeRideApi({
      listNotifications: vi.fn(async () => ({
        notifications: [
          notification({
            id: 'notification-1',
            type: 'RIDE_REQUESTED',
            title: 'New ride request',
            read: false,
            rideId: 'ride-1',
            requestId: 'request-1',
          }),
        ],
        unreadCount: 1,
        hasMore: false,
      })),
      acceptRequest: vi.fn(async () => {
        throw new MobileError(
          'business-rule',
          'Ride is not accepting requests in status CONFIRMED',
          { code: 'BUSINESS_RULE_VIOLATION' },
        );
      }),
    });
    const root = await renderAndSettle(
      <NotificationsScreen navigation={fakeNavigation()} rideApi={rideApi} />,
    );
    await press(root, { accessibilityLabel: 'Accept request' });
    expect(extractText(root.toJSON())).toContain(
      'Ride is not accepting requests in status CONFIRMED',
    );
  });
});
