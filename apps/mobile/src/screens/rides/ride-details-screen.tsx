/**
 * Ride details screen (Phase 3.15 — MOBILE RIDE PARTICIPANT FLOW; Phase 3.20 —
 * map + route preview).
 *
 * Full view of one ride plus the participant's core action — request seats
 * (POST /api/v1/rides/:rideId/requests) — and, for the ride's creator, cancel
 * (POST /api/v1/rides/:rideId/cancel).
 *
 * Phase 3.20 adds a map showing the ride's pickup and destination plus an
 * optional route preview (distance/duration) through the provider-neutral
 * `RoutingProvider` boundary (OD-007 → Google Maps). The route is loaded
 * on-demand when the screen mounts; with no Maps provider configured the map
 * renders an explanatory placeholder and the route preview is hidden.
 *
 * Identity: `userId` is used ONLY for presentational decisions (show the
 * creator-only cancel action). No identity is sent in any request — the
 * backend derives it from the API client's auth headers.
 *
 * The ride is passed in as a snapshot from the discovery list because the
 * backend has no single-ride GET endpoint (documented limitation).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { ErrorView } from '../../components/error-view';
import { LoadingView } from '../../components/loading-view';
import { RidePoolMap } from '../../components/ride-pool-map';
import { RoutePreview } from '../../components/route-preview';
import { useAsync } from '../../hooks/use-async';
import { useRoute } from '../../hooks/use-route';
import {
  asLocationReference,
  formatLocationReference,
} from '../../location/coordinate';
import {
  failClosedRoutingProvider,
  type RoutingProvider,
} from '../../location/routing';
import type { AppNavigation } from '../../navigation/app-navigator';
import { ROUTES } from '../../navigation/routes';
import type { RideApi } from '../../ride/api';
import {
  formatDateTime,
  formatDistance,
  formatPricePerKm,
} from '../../ride/format';
import type { RideRequest, RideSummary } from '../../ride/types';
import { parseRequestedSeats } from '../../ride/validation';
import { colors, spacing, typography } from '../../theme';

export interface RideDetailsScreenProps {
  navigation: AppNavigation;
  ride: RideSummary;
  /** Presentational identity (creator-only actions). Never sent to the API. */
  userId: string;
  rideApi: RideApi;
  /** Called with each successfully created ride request (session-local). */
  onRequested?: (request: RideRequest, ride: RideSummary) => void;
  /** Injectable routing provider (defaults to the fail-closed provider);
   * tests inject fakes. */
  routingProvider?: RoutingProvider;
}

const REQUESTABLE_STATUSES = ['PUBLISHED', 'CONFIRMED'];

export function RideDetailsScreen({
  navigation,
  ride,
  userId,
  rideApi,
  onRequested,
  routingProvider = failClosedRoutingProvider,
}: RideDetailsScreenProps) {
  const isCreator = ride.creator.id === userId;
  const canRequest = REQUESTABLE_STATUSES.includes(ride.status);

  const [seats, setSeats] = useState('1');
  const [seatsError, setSeatsError] = useState<string | null>(null);
  const seatsRef = useRef<number>(1);
  const [lastRequestedId, setLastRequestedId] = useState<string | null>(null);

  const route = useRoute(routingProvider);
  const pickupRef = asLocationReference(ride.pickupLocation);
  const destinationRef = asLocationReference(ride.destinationLocation);

  const origin = useMemo(
    () => ({ latitude: pickupRef.latitude, longitude: pickupRef.longitude }),
    [pickupRef.latitude, pickupRef.longitude],
  );
  const dest = useMemo(
    () => ({
      latitude: destinationRef.latitude,
      longitude: destinationRef.longitude,
    }),
    [destinationRef.latitude, destinationRef.longitude],
  );

  useEffect(() => {
    void route.calculateRoute(origin, dest);
  }, [route.calculateRoute, origin, dest]);

  const requestOperation = useCallback(
    async () =>
      rideApi.requestSeats({
        rideId: ride.id,
        requestedSeats: seatsRef.current,
      }),
    [ride.id, rideApi],
  );
  const { state: requestState, run: runRequest } = useAsync(requestOperation);

  const cancelOperation = useCallback(
    async () => rideApi.cancelRide({ rideId: ride.id }),
    [ride.id, rideApi],
  );
  const { state: cancelState, run: runCancel } = useAsync(cancelOperation);

  useEffect(() => {
    if (
      requestState.status === 'success' &&
      requestState.data.id !== lastRequestedId
    ) {
      setLastRequestedId(requestState.data.id);
      onRequested?.(requestState.data, ride);
    }
  }, [requestState, ride, onRequested, lastRequestedId]);

  const handleRequest = () => {
    const parsed = parseRequestedSeats(seats, ride.availableSeats);
    if (!parsed.ok) {
      setSeatsError(parsed.error);
      return;
    }
    setSeatsError(null);
    seatsRef.current = parsed.value;
    void runRequest();
  };

  const handleCancel = () => {
    void runCancel();
  };

  const requestSent = requestState.status === 'success';
  // Pickup/destination render through the Phase 3.12 `LocationReference`
  // contract (label when present, else "latitude, longitude").
  const pickup = formatLocationReference(pickupRef);
  const destination = formatLocationReference(destinationRef);
  const cancelled = cancelState.status === 'success';
  const routeData = route.state.status === 'success' ? route.state.data : null;
  const routeUnavailable = routingProvider.id === 'fail-closed';
  const routeError = route.state.status === 'error' ? route.state.error : null;

  return (
    <ScrollView>
      <Text style={styles.route}>
        {pickup} → {destination}
      </Text>

      <RidePoolMap
        initialCoordinate={{
          latitude: pickupRef.latitude,
          longitude: pickupRef.longitude,
        }}
        markers={[
          {
            id: 'pickup',
            coordinate: {
              latitude: pickupRef.latitude,
              longitude: pickupRef.longitude,
            },
            kind: 'pickup',
            title: 'Pickup',
          },
          {
            id: 'drop-off',
            coordinate: {
              latitude: destinationRef.latitude,
              longitude: destinationRef.longitude,
            },
            kind: 'drop-off',
            title: 'Destination',
          },
        ]}
        route={routeData}
        unavailable={routeUnavailable}
        accessibilityLabel="Ride route map"
      />
      {routeData !== null && <RoutePreview route={routeData} />}
      {routeError !== null && !routeUnavailable && (
        <Text style={styles.formError}>
          Route unavailable: {routeError.message}
        </Text>
      )}

      <Text style={styles.detail}>
        Departure: {formatDateTime(ride.departureDateTime)}
      </Text>
      <Text style={styles.detail}>Creator: {ride.creator.name}</Text>
      <Text style={styles.detail}>
        Seats: {ride.availableSeats} of {ride.totalSeats} available
      </Text>
      <Text style={styles.detail}>
        Price: {formatPricePerKm(ride.pricePerKm)}
      </Text>
      <Text style={styles.detail}>
        Distance from your pickup: {formatDistance(ride.distanceMeters)}
      </Text>
      <Text style={styles.detail}>Status: {ride.status}</Text>

      {cancelled && (
        <Text style={styles.confirmation}>
          This ride was cancelled. It is no longer discoverable.
        </Text>
      )}

      {isCreator && !cancelled && (
        <>
          <Text style={styles.section}>You created this ride.</Text>
          {cancelState.status === 'error' && (
            <ErrorView error={cancelState.error} />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel ride"
            onPress={handleCancel}
            style={styles.cancelButton}
          >
            {cancelState.status === 'loading' ? (
              <LoadingView label="Cancelling…" />
            ) : (
              <Text style={styles.cancelLabel}>Cancel ride</Text>
            )}
          </Pressable>
        </>
      )}

      {!isCreator && canRequest && !requestSent && (
        <>
          <Text style={styles.section}>Request to join</Text>
          <TextInput
            accessibilityLabel="Requested seats"
            value={seats}
            onChangeText={setSeats}
            keyboardType="numeric"
            placeholder="Seats"
            style={styles.input}
          />
          {seatsError !== null && (
            <Text style={styles.formError}>{seatsError}</Text>
          )}
          {requestState.status === 'error' && (
            <ErrorView error={requestState.error} />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Request to join"
            onPress={handleRequest}
            style={styles.requestButton}
          >
            {requestState.status === 'loading' ? (
              <LoadingView label="Requesting…" />
            ) : (
              <Text style={styles.requestLabel}>Request to join</Text>
            )}
          </Pressable>
        </>
      )}

      {!isCreator && !canRequest && !requestSent && (
        <Text style={styles.note}>
          This ride is not open to requests in its current state.
        </Text>
      )}

      {requestSent && (
        <Text style={styles.confirmation}>
          Request sent — you requested {requestState.data.requestedSeats} seat
          {requestState.data.requestedSeats === 1 ? '' : 's'}. The creator will
          review it. Track it under My Requests.
        </Text>
      )}

      {!isCreator && (
        <>
          <Text style={styles.section}>Safety</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Report user"
            onPress={() =>
              navigation.navigate(ROUTES.REPORT_USER, {
                targetUserId: ride.creator.id,
                targetUserName: ride.creator.name,
                rideId: ride.id,
              })
            }
            style={styles.reportButton}
          >
            <Text style={styles.reportLabel}>Report {ride.creator.name}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Block user"
            onPress={() =>
              navigation.navigate(ROUTES.BLOCK_USER, {
                targetUserId: ride.creator.id,
                targetUserName: ride.creator.name,
              })
            }
            style={styles.blockButton}
          >
            <Text style={styles.blockLabel}>Block {ride.creator.name}</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  route: {
    ...typography.title,
    color: colors.textPrimary,
  },
  detail: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  section: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    padding: spacing.sm,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  formError: {
    ...typography.caption,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
  requestButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginTop: spacing.sm,
  },
  requestLabel: {
    color: colors.background,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
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
    marginTop: spacing.lg,
  },
  note: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.lg,
  },
  reportButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
  },
  reportLabel: {
    color: colors.textPrimary,
  },
  blockButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
  },
  blockLabel: {
    color: colors.danger,
  },
});
