import { describe, expect, it, vi } from 'vitest';
import { MobileError } from '../../api/errors';
import { renderAndSettle, extractText, press } from '../../../tests/render';
import { block, fakeNavigation, fakeSafetyApi } from '../../../tests/fixtures';
import { BlockUserScreen } from './block-user-screen';

describe('BlockUserScreen', () => {
  it('never implies blocking will cancel an existing ride, before or after confirming', async () => {
    const FORBIDDEN = /will cancel|this will cancel|cancels? your ride/i;
    const safetyApi = fakeSafetyApi();
    const root = await renderAndSettle(
      <BlockUserScreen
        navigation={fakeNavigation()}
        targetUserId="user-2"
        targetUserName="Bo"
        safetyApi={safetyApi}
      />,
    );
    // Before confirming: the initial explanation must not suggest blocking
    // cancels a ride — only the explicit "does not cancel" reassurance
    // (DECIDED, `docs/planning/phases/phase-3-24.md` §13 item 3).
    expect(extractText(root.toJSON())).not.toMatch(FORBIDDEN);
    expect(extractText(root.toJSON())).toContain('does not cancel');

    await press(root, { accessibilityLabel: 'Block user' });
    expect(extractText(root.toJSON())).not.toMatch(FORBIDDEN);
    expect(extractText(root.toJSON())).toContain(
      'does not cancel any existing confirmed ride',
    );
  });

  it('does not call the API until the confirmation step is completed', async () => {
    const safetyApi = fakeSafetyApi();
    const root = await renderAndSettle(
      <BlockUserScreen
        navigation={fakeNavigation()}
        targetUserId="user-2"
        targetUserName="Bo"
        safetyApi={safetyApi}
      />,
    );
    await press(root, { accessibilityLabel: 'Block user' });
    expect(safetyApi.createBlock).not.toHaveBeenCalled();
    expect(extractText(root.toJSON())).toContain('Are you sure');
  });

  it('calls createBlock only after "Confirm block" is pressed', async () => {
    const safetyApi = fakeSafetyApi({
      createBlock: vi.fn(async () => block({ id: 'block-9' })),
    });
    const root = await renderAndSettle(
      <BlockUserScreen
        navigation={fakeNavigation()}
        targetUserId="user-2"
        targetUserName="Bo"
        safetyApi={safetyApi}
      />,
    );
    await press(root, { accessibilityLabel: 'Block user' });
    await press(root, { accessibilityLabel: 'Confirm block' });
    expect(safetyApi.createBlock).toHaveBeenCalledWith({
      blockedUserId: 'user-2',
    });
    expect(extractText(root.toJSON())).toContain('now blocked');
  });

  it('returns to the unconfirmed state when "Cancel" is pressed', async () => {
    const safetyApi = fakeSafetyApi();
    const root = await renderAndSettle(
      <BlockUserScreen
        navigation={fakeNavigation()}
        targetUserId="user-2"
        targetUserName="Bo"
        safetyApi={safetyApi}
      />,
    );
    await press(root, { accessibilityLabel: 'Block user' });
    await press(root, { accessibilityLabel: 'Cancel block' });
    expect(safetyApi.createBlock).not.toHaveBeenCalled();
    expect(extractText(root.toJSON())).not.toContain('Are you sure');
  });

  it('shows a normalized message for a co-participant-scope violation (403)', async () => {
    const safetyApi = fakeSafetyApi({
      createBlock: vi.fn(async () => {
        throw new MobileError(
          'authorization',
          'You can only block a user you have shared a ride with',
          { code: 'AUTHORIZATION_ERROR', statusCode: 403 },
        );
      }),
    });
    const root = await renderAndSettle(
      <BlockUserScreen
        navigation={fakeNavigation()}
        targetUserId="user-2"
        targetUserName="Bo"
        safetyApi={safetyApi}
      />,
    );
    await press(root, { accessibilityLabel: 'Block user' });
    await press(root, { accessibilityLabel: 'Confirm block' });
    expect(extractText(root.toJSON())).toContain(
      'You do not have permission to do this.',
    );
  });
});
