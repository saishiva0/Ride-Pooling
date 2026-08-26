/**
 * Navigation route model (Phase 3.13 — MOBILE FOUNDATION, §9; Phase 3.15).
 *
 * Minimal, typed, and framework-free: two conceptual route groups (the
 * public/authenticated boundary and the authenticated application boundary)
 * and the routes within them. Phase 3.15 adds the authenticated ride routes
 * (discover list, ride details, my requests, notifications).
 *
 * Navigation is deliberately decoupled from the authentication implementation
 * — the navigator only asks "is there an authenticated session?" and never
 * touches credentials. There is still no navigation library: `AppNavigator`
 * renders the active route from this typed model (framework-free, matching the
 * project's no-unapproved-dependency rule).
 */
import type { RideSummary } from '../ride/types';

export const ROUTE_GROUPS = {
  AUTH: 'auth',
  APP: 'app',
} as const;

export type RouteGroup = (typeof ROUTE_GROUPS)[keyof typeof ROUTE_GROUPS];

export const ROUTES = {
  /** Public auth flow: phone entry (Phase 3.18). */
  AUTH_PHONE: 'AuthPhone',
  /** Public auth flow: OTP verification (Phase 3.18). */
  AUTH_OTP: 'AuthOtp',
  /** Restoring-boundary splash (rendered while the session is restored). */
  AUTH_RESTORING: 'AuthRestoring',
  /** Ride discovery (authenticated): search + result list. */
  RIDES: 'Rides',
  /** Ride details (authenticated): full ride + request/cancel actions. */
  RIDE_DETAILS: 'RideDetails',
  /** Session-local request states (authenticated). */
  REQUESTS: 'Requests',
  /** The authenticated user's notifications (authenticated). */
  NOTIFICATIONS: 'Notifications',
  /** Creator: create a new ride (draft). */
  CREATE_RIDE: 'CreateRide',
  /** Creator: list own rides with status. */
  MY_RIDES: 'MyRides',
  /** Creator: active ride (start/complete). */
  ACTIVE_RIDE: 'ActiveRide',
  /** Creator: ride history (completed rides). */
  RIDE_HISTORY: 'RideHistory',
  /** Matching (authenticated): find compatible rides. */
  MATCHING: 'Matching',
  /** Report a ride co-participant (Phase 3.24 — Reporting & Blocking). */
  REPORT_USER: 'ReportUser',
  /** Block a ride co-participant (Phase 3.24 — Reporting & Blocking). */
  BLOCK_USER: 'BlockUser',
  /** The authenticated user's currently-active blocks, with unblock
   * (Phase 3.24 — Reporting & Blocking). */
  BLOCKED_USERS: 'BlockedUsers',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

/** Route → params map. `RideDetails` carries the full ride snapshot because
 * the backend has no single-ride GET endpoint (documented limitation). */
export interface RouteParamList {
  AuthPhone: undefined;
  AuthOtp: { phone: string };
  AuthRestoring: undefined;
  Rides: undefined;
  RideDetails: { ride: RideSummary };
  Requests: undefined;
  Notifications: undefined;
  CreateRide: undefined;
  MyRides: undefined;
  ActiveRide: { rideId: string };
  RideHistory: undefined;
  Matching: undefined;
  /** The reported user's ride co-participant identity plus the optional
   * ride the report relates to. */
  ReportUser: { targetUserId: string; targetUserName: string; rideId?: string };
  /** The blocked user's ride co-participant identity. */
  BlockUser: { targetUserId: string; targetUserName: string };
  BlockedUsers: undefined;
}

/** Which route group a route belongs to. */
export const ROUTE_GROUP_BY_ROUTE: Record<AppRoute, RouteGroup> = {
  [ROUTES.AUTH_PHONE]: ROUTE_GROUPS.AUTH,
  [ROUTES.AUTH_OTP]: ROUTE_GROUPS.AUTH,
  [ROUTES.AUTH_RESTORING]: ROUTE_GROUPS.AUTH,
  [ROUTES.RIDES]: ROUTE_GROUPS.APP,
  [ROUTES.RIDE_DETAILS]: ROUTE_GROUPS.APP,
  [ROUTES.REQUESTS]: ROUTE_GROUPS.APP,
  [ROUTES.NOTIFICATIONS]: ROUTE_GROUPS.APP,
  [ROUTES.CREATE_RIDE]: ROUTE_GROUPS.APP,
  [ROUTES.MY_RIDES]: ROUTE_GROUPS.APP,
  [ROUTES.ACTIVE_RIDE]: ROUTE_GROUPS.APP,
  [ROUTES.RIDE_HISTORY]: ROUTE_GROUPS.APP,
  [ROUTES.MATCHING]: ROUTE_GROUPS.APP,
  [ROUTES.REPORT_USER]: ROUTE_GROUPS.APP,
  [ROUTES.BLOCK_USER]: ROUTE_GROUPS.APP,
  [ROUTES.BLOCKED_USERS]: ROUTE_GROUPS.APP,
};
