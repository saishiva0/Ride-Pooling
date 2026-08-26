import type { RideSummary } from '../ride/types';

export const ROUTE_GROUPS = { AUTH: 'auth', APP: 'app' } as const;
export type RouteGroup = (typeof ROUTE_GROUPS)[keyof typeof ROUTE_GROUPS];

export const ROUTES = {
  AUTH_PHONE: 'AuthPhone',
  AUTH_OTP: 'AuthOtp',
  AUTH_RESTORING: 'AuthRestoring',
  RIDES: 'Rides',
  RIDE_DETAILS: 'RideDetails',
  REQUESTS: 'Requests',
  NOTIFICATIONS: 'Notifications',
  CREATE_RIDE: 'CreateRide',
  MY_RIDES: 'MyRides',
  ACTIVE_RIDE: 'ActiveRide',
  RIDE_HISTORY: 'RideHistory',
  MATCHING: 'Matching',
  REPORT_USER: 'ReportUser',
  BLOCK_USER: 'BlockUser',
  BLOCKED_USERS: 'BlockedUsers',
  CHAT: 'Chat',
} as const;
export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

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
  ReportUser: { targetUserId: string; targetUserName: string; rideId?: string };
  BlockUser: { targetUserId: string; targetUserName: string };
  BlockedUsers: undefined;
  Chat: { rideId: string };
}

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
  [ROUTES.CHAT]: ROUTE_GROUPS.APP,
};
