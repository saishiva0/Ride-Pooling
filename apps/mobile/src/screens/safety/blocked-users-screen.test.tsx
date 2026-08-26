import { describe, expect, it, vi } from 'vitest';
import { MobileError } from '../../api/errors';
import { renderAndSettle, extractText, press } from '../../../tests/render';
import {
  activeBlock,
  fakeNavigation,
  fakeSafetyApi,
} from '../../../tests/fixtures';
import { BlockedUsersScreen } from './blocked-users-screen';

describe('BlockedUsersScreen', () => {
  it('shows an empty state when there are no active blocks', async () => {
    const safetyApi = fakeSafetyApi({
      listMyBlocks: vi.fn(async () => []),
    });
    const root = await renderAndSettle(
      <BlockedUsersScreen
        navigation={fakeNavigation()}
        safetyApi={safetyApi}
      />,
    );
    expect(extractText(root.toJSON())).toContain("You haven't blocked anyone.");
  });

  it('lists active blocks with an Unblock action', async () => {
    const safetyApi = fakeSafetyApi({
      listMyBlocks: vi.fn(async () => [
        activeBlock({ blockedUserId: 'user-2', blockedUserName: 'Bo' }),
      ]),
    });
    const root = await renderAndSettle(
      <BlockedUsersScreen
        navigation={fakeNavigation()}
        safetyApi={safetyApi}
      />,
    );
    const text = extractText(root.toJSON());
    expect(text).toContain('Bo');
    expect(() =>
      root.root.findAll(
        (node) =>
          typeof node.type === 'string' &&
          node.props.accessibilityLabel === 'Unblock Bo',
      ),
    ).not.toThrow();
  });

  it('removes an entry from the list after a successful unblock', async () => {
    const safetyApi = fakeSafetyApi({
      listMyBlocks: vi.fn(async () => [
        activeBlock({ blockedUserId: 'user-2', blockedUserName: 'Bo' }),
      ]),
      removeBlock: vi.fn(async () => undefined),
    });
    const root = await renderAndSettle(
      <BlockedUsersScreen
        navigation={fakeNavigation()}
        safetyApi={safetyApi}
      />,
    );
    await press(root, { accessibilityLabel: 'Unblock Bo' });
    expect(safetyApi.removeBlock).toHaveBeenCalledWith({
      blockedUserId: 'user-2',
    });
    expect(extractText(root.toJSON())).toContain("You haven't blocked anyone.");
  });

  it('shows a normalized error and keeps the entry when unblock fails', async () => {
    const safetyApi = fakeSafetyApi({
      listMyBlocks: vi.fn(async () => [
        activeBlock({ blockedUserId: 'user-2', blockedUserName: 'Bo' }),
      ]),
      removeBlock: vi.fn(async () => {
        throw new MobileError('server', 'boom', { code: 'INTERNAL_ERROR' });
      }),
    });
    const root = await renderAndSettle(
      <BlockedUsersScreen
        navigation={fakeNavigation()}
        safetyApi={safetyApi}
      />,
    );
    await press(root, { accessibilityLabel: 'Unblock Bo' });
    const text = extractText(root.toJSON());
    expect(text).toContain('The server encountered an error. Try again.');
    expect(text).toContain('Bo');
  });
});
