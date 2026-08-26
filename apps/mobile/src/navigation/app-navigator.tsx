/**
 * AppNavigator (Phase 3.15 — MOBILE RIDE PARTICIPANT FLOW; Phase 3.20 —
 * Google Maps location dependencies).
 *
 * The authenticated application shell. Framework-free by design (no navigation
 * library — consistent with the project's no-unapproved-dependency rule): it
 * holds a typed stack of routes (from `routes.ts`) and renders the active
 * screen with a typed `AppNavigation` (`navigate`/`goBack`).
 *
 * Responsibilities:
 * - Renders the top-level tabs (Discover / My Requests / Notifications) and
 *   pushes RideDetails on top of the stack with a back affordance.
 * - Owns the session-local request store (see `request-store.ts`) so the "My
 *   Requests" screen reflects requests created this session (the backend has
 *   no request-list endpoint — documented limitation).
 * - Builds the default `RideApi` over the generic client with the auth
 *   headers provider from the auth context (Phase 3.18 — real bearer session).
 *   Tests inject a mock `RideApi`.
 * - Builds the default location & maps dependencies (device location,
 *   geocoding, routing) via `createDefaultLocationDependencies` (Phase 3.20 —
 *   Google Maps when a key is configured, fail-closed otherwise). Tests
 *   inject fakes.
 *
 * Identity: reads the authenticated session ONLY to drive presentational
 * decisions (e.g. creator-only actions); no identity is ever sent by the API.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createApiClient } from '../api/client';
import { useAuth } from '../auth/auth-provider';
import type { AuthHeadersProvider } from '../auth/auth-headers';
import { Screen } from '../components/screen';
import { loadMobileConfig } from '../config/env';
import { createDefaultLocationDependencies } from '../location/create-default-location-dependencies';
import type { GeocodingProvider } from '../location/geocoding';
import type { LocationClient } from '../location/location-client';
import type { RoutingProvider } from '../location/routing';
import { createRequestStore, type StoredRequest } from '../ride/request-store';
import { createRideApi, type RideApi } from '../ride/api';
import type { RideRequest, RideSummary } from '../ride/types';
import { createSafetyApi, type SafetyApi } from '../safety/api';
import { MyRequestsScreen } from '../screens/requests/my-requests-screen';
import { NotificationsScreen } from '../screens/notifications/notifications-screen';
import { BlockUserScreen } from '../screens/safety/block-user-screen';
import { BlockedUsersScreen } from '../screens/safety/blocked-users-screen';
import { ReportUserScreen } from '../screens/safety/report-user-screen';
import { RideDetailsScreen } from '../screens/rides/ride-details-screen';
import { RidesHomeScreen } from '../screens/rides/rides-home-screen';
import { CreateRideScreen } from '../screens/rides/create-ride-screen';
import { MyRidesScreen } from '../screens/rides/my-rides-screen';
import { ActiveRideScreen } from '../screens/rides/active-ride-screen';
import { RideHistoryScreen } from '../screens/rides/ride-history-screen';
import { MatchingScreen } from '../screens/rides/matching-screen';
import { colors, spacing, typography } from '../theme';
import { ROUTES } from './routes';
import {
  initializeNotifications,
  useNotificationsAuth,
  setNotificationsApiClient,
} from '../notifications';

/** Params for `ReportUser` (report a ride co-participant, Phase 3.24). */
interface ReportUserParams {
  targetUserId: string;
  targetUserName: string;
  rideId?: string;
}

/** Params for `BlockUser` (block a ride co-participant, Phase 3.24). */
interface BlockUserParams {
  targetUserId: string;
  targetUserName: string;
}

/** A stack entry: a route plus its typed params. */
export type AppStackEntry =
  | { route: typeof ROUTES.RIDES; params: undefined }
  | { route: typeof ROUTES.RIDE_DETAILS; params: { ride: RideSummary } }
  | { route: typeof ROUTES.REQUESTS; params: undefined }
  | { route: typeof ROUTES.NOTIFICATIONS; params: undefined }
  | { route: typeof ROUTES.CREATE_RIDE; params: undefined }
  | { route: typeof ROUTES.MY_RIDES; params: undefined }
  | { route: typeof ROUTES.ACTIVE_RIDE; params: { rideId: string } }
  | { route: typeof ROUTES.RIDE_HISTORY; params: undefined }
  | { route: typeof ROUTES.MATCHING; params: undefined }
  | { route: typeof ROUTES.REPORT_USER; params: ReportUserParams }
  | { route: typeof ROUTES.BLOCK_USER; params: BlockUserParams }
  | { route: typeof ROUTES.BLOCKED_USERS; params: undefined };

/** Typed navigation object handed to screens. */
export interface AppNavigation {
  navigate(route: typeof ROUTES.RIDES): void;
  navigate(route: typeof ROUTES.REQUESTS): void;
  navigate(route: typeof ROUTES.NOTIFICATIONS): void;
  navigate(route: typeof ROUTES.CREATE_RIDE): void;
  navigate(route: typeof ROUTES.MY_RIDES): void;
  navigate(route: typeof ROUTES.RIDE_HISTORY): void;
  navigate(route: typeof ROUTES.MATCHING): void;
  navigate(route: typeof ROUTES.BLOCKED_USERS): void;
  navigate(
    route: typeof ROUTES.RIDE_DETAILS,
    params: { ride: RideSummary },
  ): void;
  navigate(route: typeof ROUTES.ACTIVE_RIDE, params: { rideId: string }): void;
  navigate(route: typeof ROUTES.REPORT_USER, params: ReportUserParams): void;
  navigate(route: typeof ROUTES.BLOCK_USER, params: BlockUserParams): void;
  goBack(): void;
}

export interface AppNavigatorProps {
  /** Injectable for tests; defaults to a client over the config base URL. */
  rideApi?: RideApi;
  /** Injectable device-location client for tests; defaults to the fail-closed
   * `unavailableLocationClient` (Phase 3.16 — no device provider yet). */
  locationClient?: LocationClient;
  /** Injectable geocoding provider for tests; defaults to the Phase 3.20
   * Google-backed provider (fail-closed without a Maps key). */
  geocodingProvider?: GeocodingProvider;
  /** Injectable routing provider for tests; defaults to the Phase 3.20
   * Google-backed provider (fail-closed without a Maps key). */
  routingProvider?: RoutingProvider;
}

/** Builds the default ride API over the config base URL with the auth
 * headers provider from the auth context (Phase 3.18 — real bearer session). */
export function createDefaultRideApi(
  authHeadersProvider: AuthHeadersProvider,
): RideApi {
  return createRideApi(
    createApiClient({
      baseUrl: loadMobileConfig().apiBaseUrl,
      authProvider: authHeadersProvider,
    }),
  );
}

const TAB_ROUTES = [
  { route: ROUTES.RIDES, label: 'Discover' },
  { route: ROUTES.REQUESTS, label: 'My Requests' },
  { route: ROUTES.NOTIFICATIONS, label: 'Notifications' },
  { route: ROUTES.CREATE_RIDE, label: 'Create Ride' },
  { route: ROUTES.MY_RIDES, label: 'My Rides' },
  { route: ROUTES.RIDE_HISTORY, label: 'History' },
  { route: ROUTES.MATCHING, label: 'Matching' },
  { route: ROUTES.BLOCKED_USERS, label: 'Blocked Users' },
] as const;

/** Routes pushed onto the stack (back returns to the previous screen),
 * mirroring `RIDE_DETAILS`/`ACTIVE_RIDE`'s existing push behavior. */
const PUSH_ROUTES: ReadonlySet<AppStackEntry['route']> = new Set([
  ROUTES.RIDE_DETAILS,
  ROUTES.ACTIVE_RIDE,
  ROUTES.REPORT_USER,
  ROUTES.BLOCK_USER,
]);

function routeTitle(route: AppStackEntry['route']): string {
  switch (route) {
    case ROUTES.RIDES:
      return 'Discover rides';
    case ROUTES.RIDE_DETAILS:
      return 'Ride details';
    case ROUTES.REQUESTS:
      return 'My requests';
    case ROUTES.NOTIFICATIONS:
      return 'Notifications';
    case ROUTES.CREATE_RIDE:
      return 'Create ride';
    case ROUTES.MY_RIDES:
      return 'My rides';
    case ROUTES.ACTIVE_RIDE:
      return 'Active ride';
    case ROUTES.RIDE_HISTORY:
      return 'Ride history';
    case ROUTES.MATCHING:
      return 'Find matches';
    case ROUTES.REPORT_USER:
      return 'Report user';
    case ROUTES.BLOCK_USER:
      return 'Block user';
    case ROUTES.BLOCKED_USERS:
      return 'Blocked users';
    default:
      return '';
  }
}

export function AppNavigator({
  rideApi,
  locationClient,
  geocodingProvider,
  routingProvider,
}: AppNavigatorProps) {
  const { session, headersProvider } = useAuth();
  const userId = session?.user.userId ?? '';
  const api = useMemo(
    () => rideApi ?? createDefaultRideApi(headersProvider),
    [rideApi, headersProvider],
  );

  // Set the API client for notifications (Phase 3.23)
  const apiClient = useMemo(
    () =>
      createApiClient({
        baseUrl: loadMobileConfig().apiBaseUrl,
        authProvider: headersProvider,
      }),
    [headersProvider],
  );
  useEffect(() => {
    setNotificationsApiClient(apiClient);
  }, [apiClient]);
  // Phase 3.24: reporting/blocking reuses the same authenticated client.
  const safetyApi = useMemo<SafetyApi>(
    () => createSafetyApi(apiClient),
    [apiClient],
  );
  const defaultDeps = useMemo(() => createDefaultLocationDependencies(), []);
  const location = useMemo(
    () => locationClient ?? defaultDeps.locationClient,
    [locationClient, defaultDeps],
  );
  const geocoding = useMemo(
    () => geocodingProvider ?? defaultDeps.geocodingProvider,
    [geocodingProvider, defaultDeps],
  );
  const routing = useMemo(
    () => routingProvider ?? defaultDeps.routingProvider,
    [routingProvider, defaultDeps],
  );

  // Initialize notifications (Phase 3.23)
  useNotificationsAuth();
  useEffect(() => {
    const navRef = { current: navigation };
    initializeNotifications(navRef);
  }, []);

  const [stack, setStack] = useState<AppStackEntry[]>([
    { route: ROUTES.RIDES, params: undefined },
  ]);
  const current = stack[stack.length - 1];

  const store = useMemo(() => createRequestStore(), []);
  const [requests, setRequests] = useState<readonly StoredRequest[]>(() =>
    store.list(),
  );
  useEffect(() => store.subscribe(() => setRequests(store.list())), [store]);

  const navigate = useCallback(
    (
      route: AppStackEntry['route'],
      params?:
        | { ride: RideSummary }
        | { rideId: string }
        | ReportUserParams
        | BlockUserParams,
    ) => {
      if (PUSH_ROUTES.has(route)) {
        // Push onto the stack (back returns to the previous screen).
        if (params === undefined) {
          return;
        }
        setStack((prev) => [...prev, { route, params } as AppStackEntry]);
      } else {
        // Top-level tabs replace the stack.
        setStack([{ route, params: undefined } as AppStackEntry]);
      }
    },
    [],
  );

  const goBack = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const navigation = useMemo<AppNavigation>(
    () => ({ navigate, goBack }),
    [navigate, goBack],
  );

  const handleRequested = useCallback(
    (request: RideRequest, ride: RideSummary) => {
      store.add({
        id: request.id,
        rideId: request.rideId,
        ride,
        requestedSeats: request.requestedSeats,
        status: request.status,
        createdAt: request.createdAt,
      });
    },
    [store],
  );

  // Phase 3.21: a participant-initiated cancellation (withdraw/cancel) is
  // reflected in the session-local store immediately, matching the backend's
  // authoritative CANCELLED status.
  const handleRequestCancelled = useCallback(
    (requestId: string) => {
      store.updateStatus(requestId, 'CANCELLED');
    },
    [store],
  );

  let content: ReactNode;
  switch (current.route) {
    case ROUTES.RIDES:
      content = (
        <RidesHomeScreen
          navigation={navigation}
          rideApi={api}
          locationClient={location}
          geocodingProvider={geocoding}
        />
      );
      break;
    case ROUTES.RIDE_DETAILS:
      content = (
        <RideDetailsScreen
          navigation={navigation}
          ride={current.params.ride}
          userId={userId}
          rideApi={api}
          onRequested={handleRequested}
          routingProvider={routing}
        />
      );
      break;
    case ROUTES.REQUESTS:
      content = (
        <MyRequestsScreen
          navigation={navigation}
          requests={requests}
          rideApi={api}
          onCancelled={handleRequestCancelled}
        />
      );
      break;
    case ROUTES.NOTIFICATIONS:
      content = <NotificationsScreen navigation={navigation} rideApi={api} />;
      break;
    case ROUTES.CREATE_RIDE:
      content = (
        <CreateRideScreen
          navigation={navigation}
          rideApi={api}
          geocodingProvider={geocoding}
          locationClient={location}
        />
      );
      break;
    case ROUTES.MY_RIDES:
      content = <MyRidesScreen navigation={navigation} rideApi={api} />;
      break;
    case ROUTES.ACTIVE_RIDE:
      content = (
        <ActiveRideScreen
          navigation={navigation}
          rideId={current.params.rideId}
          rideApi={api}
        />
      );
      break;
    case ROUTES.RIDE_HISTORY:
      content = <RideHistoryScreen navigation={navigation} rideApi={api} />;
      break;
    case ROUTES.MATCHING:
      content = <MatchingScreen navigation={navigation} />;
      break;
    case ROUTES.REPORT_USER:
      content = (
        <ReportUserScreen
          navigation={navigation}
          targetUserId={current.params.targetUserId}
          targetUserName={current.params.targetUserName}
          rideId={current.params.rideId}
          safetyApi={safetyApi}
        />
      );
      break;
    case ROUTES.BLOCK_USER:
      content = (
        <BlockUserScreen
          navigation={navigation}
          targetUserId={current.params.targetUserId}
          targetUserName={current.params.targetUserName}
          safetyApi={safetyApi}
        />
      );
      break;
    case ROUTES.BLOCKED_USERS:
      content = (
        <BlockedUsersScreen navigation={navigation} safetyApi={safetyApi} />
      );
      break;
    default:
      content = null;
  }

  const isTopLevel = !PUSH_ROUTES.has(current.route);

  return (
    <Screen>
      <View style={styles.header}>
        {!isTopLevel && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={goBack}
            style={styles.backButton}
          >
            <Text style={styles.backLabel}>Back</Text>
          </Pressable>
        )}
        <Text style={styles.headerTitle}>{routeTitle(current.route)}</Text>
      </View>
      <View style={styles.body}>{content}</View>
      {isTopLevel && (
        <View style={styles.tabs}>
          {TAB_ROUTES.map(({ route, label }) => {
            const selected = current.route === route;
            return (
              <Pressable
                key={route}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected }}
                onPress={() => navigate(route)}
                style={styles.tab}
              >
                <Text
                  style={[
                    styles.tabLabel,
                    selected ? styles.tabLabelSelected : null,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...typography.title,
    color: colors.textPrimary,
  },
  backButton: {
    marginRight: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 4,
    backgroundColor: colors.surface,
  },
  backLabel: {
    color: colors.accent,
  },
  body: {
    flex: 1,
  },
  tabs: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  tabLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  tabLabelSelected: {
    color: colors.accent,
    fontWeight: '600',
  },
});
