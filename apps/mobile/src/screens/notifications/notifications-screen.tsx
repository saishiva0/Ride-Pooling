/**
 * Notifications screen (Phase 3.15 — MOBILE RIDE PARTICIPANT FLOW).
 *
 * The authenticated user's notification feed (GET /api/v1/notifications) with
 * read state management (PATCH .../:id/read, PATCH .../read-all). It is also
 * the legitimate entry point for the creator's request decisions: a
 * RIDE_REQUESTED notification carries the `requestId`, so Accept / Reject act
 * on it (POST .../accept, POST .../reject) — the backend authorizes the actor.
 *
 * Identity is never supplied by the client; the backend derives the recipient
 * and the actor from the API client's auth headers.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { mobileErrorMessage, toMobileError } from '../../api/errors';
import { EmptyView } from '../../components/empty-view';
import { ErrorView } from '../../components/error-view';
import { LoadingView } from '../../components/loading-view';
import { useAsync } from '../../hooks/use-async';
import type { AppNavigation } from '../../navigation/app-navigator';
import { isSuccess } from '../../state/async';
import type { RideApi } from '../../ride/api';
import { formatDateTime } from '../../ride/format';
import type { RideNotification, RideNotificationList } from '../../ride/types';
import { colors, spacing, typography } from '../../theme';

export interface NotificationsScreenProps {
  navigation: AppNavigation;
  rideApi: RideApi;
}

type Decision = 'accept' | 'reject';

export function NotificationsScreen({ rideApi }: NotificationsScreenProps) {
  const listOperation = useCallback(
    async () => rideApi.listNotifications(),
    [rideApi],
  );
  const { state, run } = useAsync(listOperation);

  const [list, setList] = useState<RideNotificationList | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pendingDecisionByRequest, setPendingDecisionByRequest] = useState<
    Record<string, Decision>
  >({});
  const [actionedByRequest, setActionedByRequest] = useState<
    Record<string, Decision>
  >({});
  const [actionErrorByRequest, setActionErrorByRequest] = useState<
    Record<string, string>
  >({});
  const [pendingReadId, setPendingReadId] = useState<string | null>(null);

  useEffect(() => {
    void run();
  }, [run]);

  useEffect(() => {
    if (isSuccess(state)) {
      setList(state.data);
    }
  }, [state]);

  const displayed = list ?? (state.status === 'success' ? state.data : null);

  const handleMarkAllRead = async () => {
    setMutationError(null);
    try {
      await rideApi.markAllNotificationsRead();
      setList((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              notifications: prev.notifications.map((notification) => ({
                ...notification,
                read: true,
              })),
              unreadCount: 0,
            },
      );
    } catch (err) {
      setMutationError(mobileErrorMessage(toMobileError(err)));
    }
  };

  const handleMarkRead = async (notification: RideNotification) => {
    if (notification.read || pendingReadId === notification.id) {
      return;
    }
    setPendingReadId(notification.id);
    setMutationError(null);
    try {
      const updated = await rideApi.markNotificationRead({
        notificationId: notification.id,
      });
      setList((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              notifications: prev.notifications.map((entry) =>
                entry.id === updated.id ? updated : entry,
              ),
              unreadCount: Math.max(0, prev.unreadCount - 1),
            },
      );
    } catch (err) {
      setMutationError(mobileErrorMessage(toMobileError(err)));
    } finally {
      setPendingReadId(null);
    }
  };

  const handleDecision = async (
    notification: RideNotification,
    decision: Decision,
  ) => {
    if (notification.rideId === null || notification.requestId === null) {
      return;
    }
    const { requestId } = notification;
    setPendingDecisionByRequest((prev) => ({ ...prev, [requestId]: decision }));
    setActionErrorByRequest((prev) => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
    setMutationError(null);
    try {
      if (decision === 'accept') {
        await rideApi.acceptRequest({
          rideId: notification.rideId,
          requestId,
        });
      } else {
        await rideApi.rejectRequest({
          rideId: notification.rideId,
          requestId,
        });
      }
      setActionedByRequest((prev) => ({ ...prev, [requestId]: decision }));
    } catch (err) {
      setActionErrorByRequest((prev) => ({
        ...prev,
        [requestId]: mobileErrorMessage(toMobileError(err)),
      }));
    } finally {
      setPendingDecisionByRequest((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
    }
  };

  if (state.status === 'loading' && displayed === null) {
    return <LoadingView label="Loading notifications…" />;
  }
  if (state.status === 'error' && displayed === null) {
    return <ErrorView error={state.error} onRetry={() => void run()} />;
  }
  if (displayed === null) {
    return <LoadingView label="Loading notifications…" />;
  }

  const { notifications, unreadCount } = displayed;

  return (
    <ScrollView>
      <View style={styles.headerRow}>
        <Text style={styles.unread}>{unreadCount} unread</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mark all read"
          onPress={() => void handleMarkAllRead()}
          disabled={unreadCount === 0}
          style={[
            styles.markAllButton,
            unreadCount === 0 ? styles.markAllButtonDisabled : null,
          ]}
        >
          <Text style={styles.markAllLabel}>Mark all read</Text>
        </Pressable>
      </View>

      {mutationError !== null && (
        <Text style={styles.mutationError}>{mutationError}</Text>
      )}

      {notifications.length === 0 && (
        <EmptyView message="No notifications yet." />
      )}

      {notifications.map((notification) => {
        const title = notification.title ?? notification.type;
        const canDecide =
          notification.type === 'RIDE_REQUESTED' &&
          notification.rideId !== null &&
          notification.requestId !== null;
        const requestId = notification.requestId;
        const actioned =
          requestId === null ? undefined : actionedByRequest[requestId];
        const decisionError =
          requestId === null ? undefined : actionErrorByRequest[requestId];
        const pendingDecision =
          requestId === null ? undefined : pendingDecisionByRequest[requestId];

        return (
          <View key={notification.id} style={styles.card}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Notification: ${title}`}
              onPress={() => void handleMarkRead(notification)}
              disabled={notification.read || pendingReadId === notification.id}
              style={styles.itemPress}
            >
              <Text style={styles.title}>{title}</Text>
              {notification.body !== null && (
                <Text style={styles.body}>{notification.body}</Text>
              )}
              <Text style={styles.time}>
                {formatDateTime(notification.createdAt)}
                {notification.read ? '' : ' · unread'}
              </Text>
            </Pressable>

            {canDecide && actioned !== undefined && (
              <Text style={styles.decisionResult}>
                Request {actioned === 'accept' ? 'accepted' : 'rejected'}.
              </Text>
            )}
            {canDecide && actioned === undefined && (
              <View style={styles.decisionRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Accept request"
                  onPress={() => void handleDecision(notification, 'accept')}
                  disabled={pendingDecision !== undefined}
                  style={styles.acceptButton}
                >
                  <Text style={styles.acceptLabel}>
                    {pendingDecision === 'accept' ? 'Accepting…' : 'Accept'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reject request"
                  onPress={() => void handleDecision(notification, 'reject')}
                  disabled={pendingDecision !== undefined}
                  style={styles.rejectButton}
                >
                  <Text style={styles.rejectLabel}>
                    {pendingDecision === 'reject' ? 'Rejecting…' : 'Reject'}
                  </Text>
                </Pressable>
              </View>
            )}
            {decisionError !== undefined && (
              <Text style={styles.mutationError}>{decisionError}</Text>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  unread: {
    ...typography.body,
    color: colors.textSecondary,
  },
  markAllButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  markAllButtonDisabled: {
    backgroundColor: colors.surface,
  },
  markAllLabel: {
    color: colors.background,
  },
  mutationError: {
    ...typography.caption,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemPress: {
    alignSelf: 'stretch',
  },
  title: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  time: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  decisionRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  acceptButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginRight: spacing.sm,
  },
  acceptLabel: {
    color: colors.background,
  },
  rejectButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rejectLabel: {
    color: colors.textPrimary,
  },
  decisionResult: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
});
