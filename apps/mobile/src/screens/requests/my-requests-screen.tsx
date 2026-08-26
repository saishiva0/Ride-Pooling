/**
 * My requests screen (Phase 3.15 — MOBILE RIDE PARTICIPANT FLOW; Phase 3.21 —
 * REQUEST & PARTICIPANT LIFECYCLE COMPLETION).
 *
 * Lists the requests the current session has created, with their last-known
 * status. This is deliberately session-local (see `request-store.ts`): the
 * backend exposes request creation, decisions, and notifications but NO
 * "list my requests" endpoint, so there is no server-side list to render.
 * The backend remains authoritative for request state; acceptance/rejection
 * outcomes surface through the Notifications tab. Documented limitation.
 *
 * Phase 3.21 adds the participant's own lifecycle actions via
 * POST /api/v1/rides/:rideId/requests/:requestId/cancel (`ride-lifecycle.md`
 * §4.2): a PENDING request can be WITHDRAWN and an ACCEPTED participation can
 * be CANCELLED (seat released; last participant reverts the ride to
 * PUBLISHED). Each action calls the API and, on success, reports the request
 * id through `onCancelled` so the owner (the navigator's request store) can
 * reflect the new CANCELLED status.
 */
import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ErrorView } from '../../components/error-view';
import { EmptyView } from '../../components/empty-view';
import { LoadingView } from '../../components/loading-view';
import { useAsync } from '../../hooks/use-async';
import type { AppNavigation } from '../../navigation/app-navigator';
import { ROUTES } from '../../navigation/routes';
import type { RideApi } from '../../ride/api';
import { formatDateTime } from '../../ride/format';
import type { StoredRequest } from '../../ride/request-store';
import { colors, spacing, typography } from '../../theme';

export interface MyRequestsScreenProps {
  navigation: AppNavigation;
  requests: readonly StoredRequest[];
  /** The typed API seam for the participant's lifecycle actions. */
  rideApi: RideApi;
  /** Called with the request id after it was successfully cancelled. */
  onCancelled?: (requestId: string) => void;
}

function locationLabel(request: StoredRequest): string {
  const pickup =
    request.ride.pickupLocation.label ??
    `${request.ride.pickupLocation.latitude}, ${request.ride.pickupLocation.longitude}`;
  const destination =
    request.ride.destinationLocation.label ??
    `${request.ride.destinationLocation.latitude}, ${request.ride.destinationLocation.longitude}`;
  return `${pickup} → ${destination}`;
}

/** Whether the request is still open to a participant-initiated cancellation
 * (PENDING withdrawal or ACCEPTED participation cancellation — §4.2). */
function isCancellable(request: StoredRequest): boolean {
  return request.status === 'PENDING' || request.status === 'ACCEPTED';
}

function actionLabel(request: StoredRequest): string {
  return request.status === 'ACCEPTED' ? 'Cancel participation' : 'Withdraw';
}

interface RequestCardProps {
  request: StoredRequest;
  navigation: AppNavigation;
  rideApi: RideApi;
  onCancelled?: (requestId: string) => void;
}

function RequestCard({
  request,
  navigation,
  rideApi,
  onCancelled,
}: RequestCardProps) {
  const operation = useCallback(async () => {
    const result = await rideApi.cancelRequest({
      rideId: request.rideId,
      requestId: request.id,
    });
    onCancelled?.(request.id);
    return result;
  }, [rideApi, request.rideId, request.id, onCancelled]);
  const { state, run } = useAsync(operation);
  const cancelled = state.status === 'success';

  return (
    <View style={styles.card}>
      <Text style={styles.route}>{locationLabel(request)}</Text>
      <Text style={styles.detail}>
        {formatDateTime(request.createdAt)} · {request.requestedSeats} seat
        {request.requestedSeats === 1 ? '' : 's'}
      </Text>
      <Text style={styles.detail}>Status: {request.status}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View ride"
        onPress={() =>
          navigation.navigate(ROUTES.RIDE_DETAILS, {
            ride: request.ride,
          })
        }
        style={styles.viewButton}
      >
        <Text style={styles.viewLabel}>View ride</Text>
      </Pressable>

      {isCancellable(request) && !cancelled && (
        <>
          {state.status === 'error' && <ErrorView error={state.error} />}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={actionLabel(request)}
            onPress={() => void run()}
            style={styles.cancelButton}
          >
            {state.status === 'loading' ? (
              <LoadingView label="Cancelling…" />
            ) : (
              <Text style={styles.cancelLabel}>{actionLabel(request)}</Text>
            )}
          </Pressable>
        </>
      )}

      {cancelled && (
        <Text style={styles.confirmation}>
          {request.status === 'ACCEPTED'
            ? 'Participation cancelled — your seat was released.'
            : 'Request withdrawn.'}
        </Text>
      )}
    </View>
  );
}

export function MyRequestsScreen({
  navigation,
  requests,
  rideApi,
  onCancelled,
}: MyRequestsScreenProps) {
  if (requests.length === 0) {
    return (
      <ScrollView>
        <EmptyView message="No ride requests yet. Discover a ride to request seats." />
      </ScrollView>
    );
  }

  return (
    <ScrollView>
      <Text style={styles.note}>
        Requests you have made in this session. Outcomes appear in
        Notifications.
      </Text>
      {requests.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          navigation={navigation}
          rideApi={rideApi}
          onCancelled={onCancelled}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  note: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  route: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  detail: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  viewButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 4,
    backgroundColor: colors.accent,
    alignSelf: 'flex-start',
  },
  viewLabel: {
    color: colors.background,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: 4,
    backgroundColor: colors.danger,
    marginTop: spacing.sm,
  },
  cancelLabel: {
    color: colors.background,
  },
  confirmation: {
    ...typography.body,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
});
