import { describe, expect, it, vi } from 'vitest';
import { renderAndSettle, extractText, press } from '../../../tests/render';
import {
  fakeNavigation,
  fakeRideApi,
  rideSummary,
} from '../../../tests/fixtures';
import { ROUTES } from '../../navigation/routes';
import type { StoredRequest } from '../../ride/request-store';
import { MyRequestsScreen } from './my-requests-screen';

function storedRequest(overrides: Partial<StoredRequest> = {}): StoredRequest {
  return {
    id: 'request-1',
    rideId: 'ride-1',
    ride: rideSummary(),
    requestedSeats: 2,
    status: 'PENDING',
    createdAt: new Date('2026-08-18T10:00:00.000Z'),
    ...overrides,
  };
}

describe('MyRequestsScreen', () => {
  it('shows an empty state when there are no requests', async () => {
    const root = await renderAndSettle(
      <MyRequestsScreen
        navigation={fakeNavigation()}
        requests={[]}
        rideApi={fakeRideApi()}
      />,
    );
    expect(extractText(root.toJSON())).toContain(
      'No ride requests yet. Discover a ride to request seats.',
    );
  });

  it('lists session-local requests with their last-known status', async () => {
    const navigation = fakeNavigation();
    const root = await renderAndSettle(
      <MyRequestsScreen
        navigation={navigation}
        requests={[storedRequest()]}
        rideApi={fakeRideApi()}
      />,
    );
    const text = extractText(root.toJSON());
    expect(text).toContain('MG Road → Koramangala');
    expect(text).toContain('Aug 18, 2026 · 10:00');
    expect(text).toContain('2 seats');
    expect(text).toContain('Status: PENDING');
  });

  it('navigates to ride details from a request', async () => {
    const navigation = fakeNavigation();
    const ride = rideSummary();
    const root = await renderAndSettle(
      <MyRequestsScreen
        navigation={navigation}
        requests={[storedRequest({ ride })]}
        rideApi={fakeRideApi()}
      />,
    );
    await press(root, { accessibilityLabel: 'View ride' });
    expect(navigation.navigate).toHaveBeenCalledWith(ROUTES.RIDE_DETAILS, {
      ride,
    });
  });

  it('withdraws a PENDING request and reports it as cancelled', async () => {
    const navigation = fakeNavigation();
    const rideApi = fakeRideApi();
    const onCancelled = vi.fn();
    const root = await renderAndSettle(
      <MyRequestsScreen
        navigation={navigation}
        requests={[storedRequest()]}
        rideApi={rideApi}
        onCancelled={onCancelled}
      />,
    );
    await press(root, { accessibilityLabel: 'Withdraw' });
    expect(rideApi.cancelRequest).toHaveBeenCalledWith({
      rideId: 'ride-1',
      requestId: 'request-1',
    });
    expect(onCancelled).toHaveBeenCalledWith('request-1');
    expect(extractText(root.toJSON())).toContain('Request withdrawn.');
  });

  it('cancels an ACCEPTED participation and reports it as cancelled', async () => {
    const navigation = fakeNavigation();
    const rideApi = fakeRideApi();
    const onCancelled = vi.fn();
    const root = await renderAndSettle(
      <MyRequestsScreen
        navigation={navigation}
        requests={[storedRequest({ status: 'ACCEPTED' })]}
        rideApi={rideApi}
        onCancelled={onCancelled}
      />,
    );
    await press(root, { accessibilityLabel: 'Cancel participation' });
    expect(rideApi.cancelRequest).toHaveBeenCalledWith({
      rideId: 'ride-1',
      requestId: 'request-1',
    });
    expect(onCancelled).toHaveBeenCalledWith('request-1');
    expect(extractText(root.toJSON())).toContain(
      'Participation cancelled — your seat was released.',
    );
  });

  it('shows no lifecycle action for a REJECTED request', async () => {
    const root = await renderAndSettle(
      <MyRequestsScreen
        navigation={fakeNavigation()}
        requests={[storedRequest({ status: 'REJECTED' })]}
        rideApi={fakeRideApi()}
      />,
    );
    const text = extractText(root.toJSON());
    expect(text).not.toContain('Withdraw');
    expect(text).not.toContain('Cancel participation');
  });
});
