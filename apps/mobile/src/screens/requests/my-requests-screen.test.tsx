import { describe, expect, it, vi } from 'vitest';
import {
  renderAndSettle,
  extractText,
  flushAsync,
  press,
} from '../../../tests/render';
import {
  fakeNavigation,
  fakeRideApi,
  participantRideRequest,
} from '../../../tests/fixtures';
import { MobileError } from '../../api/errors';
import { ROUTES } from '../../navigation/routes';
import type { ParticipantRideRequest } from '../../ride/types';
import { MyRequestsScreen } from './my-requests-screen';

describe('MyRequestsScreen', () => {
  it('loads persisted requests from the backend on mount', async () => {
    const listMyRequests = vi.fn(
      async (): Promise<ParticipantRideRequest[]> => [participantRideRequest()],
    );
    const root = await renderAndSettle(
      <MyRequestsScreen
        navigation={fakeNavigation()}
        rideApi={fakeRideApi({ listMyRequests })}
      />,
    );
    expect(listMyRequests).toHaveBeenCalledTimes(1);
    const text = extractText(root.toJSON());
    expect(text).toContain('MG Road → Koramangala');
    expect(text).toContain('Status: PENDING');
    expect(text).toContain('Ride status: PUBLISHED');
  });

  it('shows a loading state while the request is in flight', async () => {
    const listMyRequests = vi.fn(
      () => new Promise<ParticipantRideRequest[]>(() => {}),
    );
    const root = await renderAndSettle(
      <MyRequestsScreen
        navigation={fakeNavigation()}
        rideApi={fakeRideApi({ listMyRequests })}
      />,
    );
    expect(extractText(root.toJSON())).toContain('Loading your requests...');
  });

  it('shows an empty state when there are no requests', async () => {
    const root = await renderAndSettle(
      <MyRequestsScreen
        navigation={fakeNavigation()}
        rideApi={fakeRideApi({
          listMyRequests: vi.fn(async () => []),
        })}
      />,
    );
    expect(extractText(root.toJSON())).toContain(
      'No ride requests yet. Discover a ride to request seats.',
    );
  });

  it('renders a normalized error and retries', async () => {
    const listMyRequests = vi
      .fn()
      .mockRejectedValueOnce(
        new MobileError('network', 'Network request failed'),
      )
      .mockResolvedValueOnce([participantRideRequest()]);
    const root = await renderAndSettle(
      <MyRequestsScreen
        navigation={fakeNavigation()}
        rideApi={fakeRideApi({ listMyRequests })}
      />,
    );
    expect(extractText(root.toJSON())).toContain(
      'Network request failed. Check your connection and try again.',
    );
    await press(root, { accessibilityLabel: 'Try again' });
    await flushAsync();
    expect(listMyRequests).toHaveBeenCalledTimes(2);
    expect(extractText(root.toJSON())).toContain('MG Road → Koramangala');
  });

  it('shows the persisted state after a simulated remount (survives restart)', async () => {
    const persisted = [
      participantRideRequest({
        request: {
          id: 'request-9',
          rideId: 'ride-1',
          requestedSeats: 2,
          status: 'ACCEPTED',
          createdAt: new Date('2026-08-18T10:00:00.000Z'),
          resolvedAt: new Date('2026-08-18T10:30:00.000Z'),
        },
      }),
    ];
    // First mount simulates an empty local session; the server returns the
    // persisted row, so the second mount (after restart) renders it too.
    const listMyRequests = vi.fn(async () => persisted);
    const first = await renderAndSettle(
      <MyRequestsScreen
        navigation={fakeNavigation()}
        rideApi={fakeRideApi({ listMyRequests })}
      />,
    );
    expect(extractText(first.toJSON())).toContain('Status: ACCEPTED');

    const second = await renderAndSettle(
      <MyRequestsScreen
        navigation={fakeNavigation()}
        rideApi={fakeRideApi({ listMyRequests })}
      />,
    );
    expect(listMyRequests).toHaveBeenCalledTimes(2);
    expect(extractText(second.toJSON())).toContain('Status: ACCEPTED');
  });

  it('navigates to ride details from a request', async () => {
    const navigation = fakeNavigation();
    const root = await renderAndSettle(
      <MyRequestsScreen
        navigation={navigation}
        rideApi={fakeRideApi({
          listMyRequests: vi.fn(async () => [participantRideRequest()]),
        })}
      />,
    );
    await press(root, { accessibilityLabel: 'View ride' });
    expect(navigation.navigate).toHaveBeenCalledWith(
      ROUTES.RIDE_DETAILS,
      expect.objectContaining({
        ride: expect.objectContaining({ id: 'ride-1' }),
      }),
    );
  });

  it('withdraws a PENDING request and reloads from the backend', async () => {
    const rideApi = fakeRideApi({
      listMyRequests: vi.fn(async () => [participantRideRequest()]),
    });
    const onCancelled = vi.fn();
    const root = await renderAndSettle(
      <MyRequestsScreen
        navigation={fakeNavigation()}
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
    const rideApi = fakeRideApi({
      listMyRequests: vi.fn(async () => [
        participantRideRequest({
          request: {
            id: 'request-1',
            rideId: 'ride-1',
            requestedSeats: 1,
            status: 'ACCEPTED',
            createdAt: new Date('2026-08-18T10:00:00.000Z'),
            resolvedAt: new Date('2026-08-18T10:30:00.000Z'),
          },
        }),
      ]),
    });
    const onCancelled = vi.fn();
    const root = await renderAndSettle(
      <MyRequestsScreen
        navigation={fakeNavigation()}
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
        rideApi={fakeRideApi({
          listMyRequests: vi.fn(async () => [
            participantRideRequest({
              request: {
                id: 'request-1',
                rideId: 'ride-1',
                requestedSeats: 1,
                status: 'REJECTED',
                createdAt: new Date('2026-08-18T10:00:00.000Z'),
                resolvedAt: new Date('2026-08-18T10:30:00.000Z'),
              },
            }),
          ]),
        })}
      />,
    );
    const text = extractText(root.toJSON());
    expect(text).not.toContain('Withdraw');
    expect(text).not.toContain('Cancel participation');
  });
});
