/**
 * Phone entry screen tests (Phase 3.18 — OD-005 resolved).
 *
 * The screen only orchestrates `requestOtp`: it never handles tokens, and any
 * failure is surfaced as the generic normalized message.
 */
import { describe, expect, it, vi } from 'vitest';
import { MobileError } from '../../api/errors';
import { AuthProvider } from '../../auth/auth-provider';
import { unavailableAuthClient } from '../../auth/auth-client';
import type { AuthNavigation } from '../../navigation/auth-navigator';
import {
  renderAndSettle,
  extractText,
  press,
  typeInto,
  flushAsync,
} from '../../../tests/render';
import { PhoneEntryScreen } from './phone-entry-screen';

function navigation(): AuthNavigation {
  return { proceedToOtp: vi.fn(), goBack: vi.fn() };
}

describe('PhoneEntryScreen', () => {
  it('renders the phone entry form with a send button', async () => {
    const root = await renderAndSettle(
      <AuthProvider client={unavailableAuthClient}>
        <PhoneEntryScreen navigation={navigation()} authError={null} />
      </AuthProvider>,
    );
    const text = extractText(root.toJSON());
    expect(text).toContain('RidePool');
    expect(text).toContain('Enter your phone number');
    expect(text).toContain('Send OTP');
  });

  it('validates a blank phone without calling requestOtp', async () => {
    const client = {
      ...unavailableAuthClient,
      requestOtp: vi.fn(async () => undefined),
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <PhoneEntryScreen navigation={navigation()} authError={null} />
      </AuthProvider>,
    );
    await press(root, { accessibilityLabel: 'Send OTP' });
    expect(extractText(root.toJSON())).toContain('Enter your phone number.');
    expect(client.requestOtp).not.toHaveBeenCalled();
  });

  it('requests an OTP and advances to verification on success', async () => {
    const nav = navigation();
    const client = {
      ...unavailableAuthClient,
      requestOtp: vi.fn(async () => undefined),
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <PhoneEntryScreen navigation={nav} authError={null} />
      </AuthProvider>,
    );
    await typeInto(root, { accessibilityLabel: 'Phone number' }, '9876543210');
    await press(root, { accessibilityLabel: 'Send OTP' });
    await flushAsync();

    expect(client.requestOtp).toHaveBeenCalledWith('9876543210');
    expect(nav.proceedToOtp).toHaveBeenCalledWith('9876543210');
  });

  it('surfaces the generic normalized message when requestOtp fails (no advance)', async () => {
    const nav = navigation();
    const client = {
      ...unavailableAuthClient,
      requestOtp: vi.fn(async () => {
        throw new MobileError('authentication', 'Unable to authenticate');
      }),
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <PhoneEntryScreen navigation={nav} authError={null} />
      </AuthProvider>,
    );
    await typeInto(root, { accessibilityLabel: 'Phone number' }, '9876543210');
    await press(root, { accessibilityLabel: 'Send OTP' });
    await flushAsync();

    expect(extractText(root.toJSON())).toContain('Authentication failed');
    expect(nav.proceedToOtp).not.toHaveBeenCalled();
  });

  it('surfaces a pending auth error from the auth state', async () => {
    const root = await renderAndSettle(
      <AuthProvider client={unavailableAuthClient}>
        <PhoneEntryScreen
          navigation={navigation()}
          authError={new MobileError('authentication', 'Session expired')}
        />
      </AuthProvider>,
    );
    const text = extractText(root.toJSON());
    expect(text).toContain('Authentication failed');
    expect(text).toContain('Send OTP');
  });
});
