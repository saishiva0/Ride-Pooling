/**
 * My requests screen (V1 rider read path; Phase 3.15/3.21 origin).
 *
 * Server-authoritative: on load it fetches the authenticated participant's own
 * requests from `GET /api/v1/rides/requests/mine` and renders the persisted
 * state. The former session-local request store is no longer the source of
 * truth, so My Requests survives an app restart.
 *
 * Phase 3.21 lifecycle actions are preserved: a PENDING request can be
 * WITHDRAWN and an ACCEPTED participation CANCELLED via
 * `POST /api/v1/rides/:rideId/requests/:requestId/cancel`; on success the list
 * is reloaded from the backend and the request id is reported through
 * `onCancelled` so any remaining UI cache can reflect it.
 *
 * Identity: none is read or sent — the backend derives it from auth headers.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ErrorView } from '../../components/error-view';
import { EmptyView } from '../../components/empty-view';
import { LoadingView } from '../../components/loading-view';
import { useAsync } from '../../hooks/use-async';
import type { AppNavigation } from '../../navigation/app-navigator';
import { ROUTES } from '../../navigation/routes';
import type { RideApi } from '../../ride/api';
import { formatDateTime } from '../../ride/format';
import type {
  CreatorRide,
  ParticipantRideRequest,
  RideSummary,
} from '../../ride/types';
import { colors, spacing, typography } from '../../theme';

export interface MyRequestsScreenProps {
  navigation: AppNavigation;
  /** The typed API seam for loading requests and lifecycle actions. */
  rideApi: RideApi;
  /** Called with the request id after it was successfully cancelled. */
  onCancelled?: (requestId: string) => void;
}

/** Presents a creator/participant ride as a `RideSummary` for the details
 * screen (distance is not part of the participant read contract). */
function toRideSummary(ride: CreatorRide): RideSummary {
  return {
    id: ride.id,
    creator: ride.creator,
    pickupLocation: ride.pickupLocation,
    destinationLocation: ride.destinationLocation,
    departureDateTime: ride.departureDateTime,
    totalSeats: ride.totalSeats,
    availableSeats: ride.availableSeats,
    pricingType: ride.pricingType,
    pricePerKm: ride.pricePerKm,
    distanceMeters: 0,
    status: ride.status,
  };
}

function locationLabel(request: ParticipantRideRequest): string {
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
function isCancellable(request: ParticipantRideRequest): boolean {
  return (
    request.request.status === 'PENDING' ||
    request.request.status === 'ACCEPTED'
  );
}

function actionLabel(request: ParticipantRideRequest): string {
  return request.request.status === 'ACCEPTED'
    ? 'Cancel participation'
    : 'Withdraw';
}

interface RequestCardProps {
  item: ParticipantRideRequest;
  navigation: AppNavigation;
  rideApi: RideApi;
  /**
   * True once this request was cancelled this session (survives the reload),
   * with the status it held at cancellation to pick the confirmation copy.
   */
  cancelledWasAccepted?: boolean;
  onCancelled: (requestId: string, wasAccepted: boolean) => void;
}

function RequestCard({
  item,
  navigation,
  rideApi,
  cancelledWasAccepted,
  onCancelled,
}: RequestCardProps) {
  const request = item.request;
  const cancelled = cancelledWasAccepted !== undefined;
  const operation = useCallback(async () => {
    const wasAccepted = request.status === 'ACCEPTED';
    const result = await rideApi.cancelRequest({
      rideId: request.rideId,
      requestId: request.id,
    });
    onCancelled(request.id, wasAccepted);
    return result;
  }, [rideApi, request.rideId, request.id, request.status, onCancelled]);
  const { state, run } = useAsync(operation);

  return (
    <View style={styles.card}>
      <Text style={styles.route}>{locationLabel(item)}</Text>
      <Text style={styles.detail}>
        {formatDateTime(request.createdAt)} · {request.requestedSeats} seat
        {request.requestedSeats === 1 ? '' : 's'}
      </Text>
      <Text style={styles.detail}>Status: {request.status}</Text>
      <Text style={styles.detail}>Ride status: {item.ride.status}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View ride"
        onPress={() =>
          navigation.navigate(ROUTES.RIDE_DETAILS, {
            ride: toRideSummary(item.ride),
          })
        }
        style={styles.viewButton}
      >
        <Text style={styles.viewLabel}>View ride</Text>
      </Pressable>

      {isCancellable(item) && !cancelled && (
        <>
          {state.status === 'error' && <ErrorView error={state.error} />}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={actionLabel(item)}
            onPress={() => void run()}
            style={styles.cancelButton}
          >
            {state.status === 'loading' ? (
              <LoadingView label="Cancelling..." />
            ) : (
              <Text style={styles.cancelLabel}>{actionLabel(item)}</Text>
            )}
          </Pressable>
        </>
      )}

      {cancelled && (
        <Text style={styles.confirmation}>
          {cancelledWasAccepted
            ? 'Participation cancelled — your seat was released.'
            : 'Request withdrawn.'}
        </Text>
      )}
    </View>
  );
}

export function MyRequestsScreen({
  navigation,
  rideApi,
  onCancelled,
}: MyRequestsScreenProps) {
  const [requests, setRequests] = useState<readonly ParticipantRideRequest[]>(
    [],
  );
  const [cancelled, setCancelled] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );

  const operation = useCallback(
    async () => rideApi.listMyRequests(),
    [rideApi],
  );
  const { state, run } = useAsync(operation);

  useEffect(() => {
    if (state.status === 'success') {
      setRequests(state.data);
    }
  }, [state]);

  useEffect(() => {
    void run();
  }, [run]);

  const handleCancelled = useCallback(
    (requestId: string, wasAccepted: boolean) => {
      setCancelled((prev) => new Map(prev).set(requestId, wasAccepted));
      onCancelled?.(requestId);
      void run();
    },
    [onCancelled, run],
  );

  if (state.status === 'loading') {
    return (
      <ScrollView>
        <LoadingView label="Loading your requests..." />
      </ScrollView>
    );
  }

  if (state.status === 'error') {
    return (
      <ScrollView>
        <ErrorView error={state.error} onRetry={run} />
      </ScrollView>
    );
  }

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
        Your ride requests. Outcomes are loaded from the server.
      </Text>
      {requests.map((item) => (
        <RequestCard
          key={item.request.id}
          item={item}
          navigation={navigation}
          rideApi={rideApi}
          cancelledWasAccepted={cancelled.get(item.request.id)}
          onCancelled={handleCancelled}
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
