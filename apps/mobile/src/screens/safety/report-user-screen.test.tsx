import { describe, expect, it, vi } from 'vitest';
import { MobileError } from '../../api/errors';
import {
  renderAndSettle,
  extractText,
  press,
  typeInto,
} from '../../../tests/render';
import { fakeNavigation, fakeSafetyApi, report } from '../../../tests/fixtures';
import { ReportUserScreen } from './report-user-screen';

describe('ReportUserScreen', () => {
  it('requires a reason before submit is enabled', async () => {
    const safetyApi = fakeSafetyApi();
    const root = await renderAndSettle(
      <ReportUserScreen
        navigation={fakeNavigation()}
        targetUserId="user-2"
        targetUserName="Bo"
        rideId="ride-1"
        safetyApi={safetyApi}
      />,
    );
    await press(root, { accessibilityLabel: 'Submit report' });
    expect(safetyApi.createReport).not.toHaveBeenCalled();
  });

  it('submits a report with the selected reason, detail, and rideId', async () => {
    const safetyApi = fakeSafetyApi({
      createReport: vi.fn(async () => report({ id: 'report-9' })),
    });
    const root = await renderAndSettle(
      <ReportUserScreen
        navigation={fakeNavigation()}
        targetUserId="user-2"
        targetUserName="Bo"
        rideId="ride-1"
        safetyApi={safetyApi}
      />,
    );

    await press(root, { accessibilityLabel: 'Reason: Harassment' });
    await typeInto(root, { accessibilityLabel: 'Report details' }, 'was rude');
    await press(root, { accessibilityLabel: 'Submit report' });

    expect(safetyApi.createReport).toHaveBeenCalledWith({
      reportedUserId: 'user-2',
      reason: 'HARASSMENT',
      detail: 'was rude',
      rideId: 'ride-1',
    });
    expect(extractText(root.toJSON())).toContain('Report submitted');
  });

  it('omits empty detail text', async () => {
    const safetyApi = fakeSafetyApi();
    const root = await renderAndSettle(
      <ReportUserScreen
        navigation={fakeNavigation()}
        targetUserId="user-2"
        targetUserName="Bo"
        safetyApi={safetyApi}
      />,
    );
    await press(root, { accessibilityLabel: 'Reason: Other' });
    await press(root, { accessibilityLabel: 'Submit report' });
    expect(safetyApi.createReport).toHaveBeenCalledWith({
      reportedUserId: 'user-2',
      reason: 'OTHER',
      detail: undefined,
      rideId: undefined,
    });
  });

  it('shows a normalized message for a co-participant-scope violation (403)', async () => {
    const safetyApi = fakeSafetyApi({
      createReport: vi.fn(async () => {
        throw new MobileError(
          'authorization',
          'You can only report a user you have shared a ride with',
          { code: 'AUTHORIZATION_ERROR', statusCode: 403 },
        );
      }),
    });
    const root = await renderAndSettle(
      <ReportUserScreen
        navigation={fakeNavigation()}
        targetUserId="user-2"
        targetUserName="Bo"
        safetyApi={safetyApi}
      />,
    );
    await press(root, { accessibilityLabel: 'Reason: Other' });
    await press(root, { accessibilityLabel: 'Submit report' });
    expect(extractText(root.toJSON())).toContain(
      'You do not have permission to do this.',
    );
  });

  it('shows a normalized message when rate-limited (429)', async () => {
    const safetyApi = fakeSafetyApi({
      createReport: vi.fn(async () => {
        throw new MobileError(
          'rate-limited',
          'Too many reports filed recently. Please try again later.',
          { code: 'RATE_LIMITED', statusCode: 429 },
        );
      }),
    });
    const root = await renderAndSettle(
      <ReportUserScreen
        navigation={fakeNavigation()}
        targetUserId="user-2"
        targetUserName="Bo"
        safetyApi={safetyApi}
      />,
    );
    await press(root, { accessibilityLabel: 'Reason: Other' });
    await press(root, { accessibilityLabel: 'Submit report' });
    expect(extractText(root.toJSON())).toContain(
      'Too many requests. Try again shortly.',
    );
  });

  it('shows the backend message for a self-report rejection (400)', async () => {
    const safetyApi = fakeSafetyApi({
      createReport: vi.fn(async () => {
        throw new MobileError('validation', 'You cannot report yourself', {
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          field: 'reportedUserId',
        });
      }),
    });
    const root = await renderAndSettle(
      <ReportUserScreen
        navigation={fakeNavigation()}
        targetUserId="user-1"
        targetUserName="Me"
        safetyApi={safetyApi}
      />,
    );
    await press(root, { accessibilityLabel: 'Reason: Other' });
    await press(root, { accessibilityLabel: 'Submit report' });
    expect(extractText(root.toJSON())).toContain('You cannot report yourself');
  });
});
