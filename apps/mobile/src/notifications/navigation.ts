/**
 * Notification tap navigation (Phase 3.23).
 *
 * Routes every notification tap to the notifications feed using the existing
 * typed navigation routes — see `getNotificationNavigationTarget` below for
 * why that is the correct, safe destination for every notification type.
 */
import type {
  PushNotificationData,
  NotificationNavigationTarget,
} from './types.js';
import { ROUTES } from '../navigation/routes.js';
import type { AppNavigation } from '../navigation/app-navigator.js';

/** Navigation context (set by the app navigator). */
let navigationRef: React.RefObject<AppNavigation> | null = null;

/** Sets the navigation reference for notification routing. */
export function setNotificationNavigationRef(
  ref: React.RefObject<AppNavigation> | null,
): void {
  navigationRef = ref;
}

/**
 * Gets the navigation target for a notification.
 *
 * Every notification type lands on the notifications feed (`GET
 * /api/v1/notifications`): it is the only screen that can render full,
 * correct context from just a push payload. `RideDetails` requires a full
 * `RideSummary` snapshot the backend does not expose for a single ride (see
 * `ride-details-screen.tsx`), so fabricating one from a bare `rideId` would
 * either crash or show broken data — the notifications feed already has the
 * accept/reject actions and real ride/request context for every type below.
 */
export function getNotificationNavigationTarget(
  _data: PushNotificationData,
): NotificationNavigationTarget {
  return { route: ROUTES.NOTIFICATIONS, params: {} };
}

/** Validates navigation data before routing — never trust arbitrary payloads. */
export function validateNotificationData(
  data: unknown,
): data is PushNotificationData {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj.type === 'string' && obj.type.length > 0;
}

/**
 * Navigates from a notification tap. Malformed/unrecognized data is logged
 * and still routed to the safe fallback — it never blocks navigation or
 * crashes the app.
 */
export async function navigateFromNotification(data: unknown): Promise<void> {
  if (!navigationRef?.current) {
    return;
  }

  if (!validateNotificationData(data)) {
    console.warn('Ignoring malformed notification payload', data);
  }

  try {
    const { route } = getNotificationNavigationTarget(
      data as PushNotificationData,
    );
    if (route === ROUTES.NOTIFICATIONS) {
      navigationRef.current.navigate(ROUTES.NOTIFICATIONS);
    }
  } catch (error) {
    console.error('Navigation from notification failed:', error);
    // Safe fallback - navigation ref might not be ready
  }
}
