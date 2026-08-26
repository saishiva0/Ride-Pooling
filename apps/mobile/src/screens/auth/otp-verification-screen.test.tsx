/**
 * OTP verification screen tests (Phase 3.18 — OD-005 resolved).
 *
 * The screen only orchestrates `signIn(phone, otp)` and `requestOtp` (resend):
 * it never handles tokens, and any failure is surfaced as the generic
 * normalized message.
 */
import { describe, expect, it, vi } from 'vitest';
import { MobileError } from '../../api/errors';
import { AuthProvider } from '../../auth/auth-provider';
import { unavailableAuthClient } from '../../auth/auth-client';
import type { AuthSession } from '../../auth/types';
import type { AuthNavigation } from '../../navigation/auth-navigator';
import {
  renderAndSettle,
  extractText,
  press,
  typeInto,
  flushAsync,
} from '../../../tests/render';
import { OtpVerificationScreen } from './otp-verification-screen';

const PHONE = '+919876543210';

function navigation(): AuthNavigation {
  return { proceedToOtp: vi.fn(), goBack: vi.fn() };
}

const sessionFor = (userId: string): AuthSession => ({ user: { userId } });

describe('OtpVerificationScreen', () => {
  it('renders the code entry form for the submitted phone', async () => {
    const root = await renderAndSettle(
      <AuthProvider client={unavailableAuthClient}>
        <OtpVerificationScreen
          phone={PHONE}
          navigation={navigation()}
          authError={null}
        />
      </AuthProvider>,
    );
    const text = extractText(root.toJSON());
    expect(text).toContain('Enter the code');
    expect(text).toContain(PHONE);
    expect(text).toContain('Verify code');
  });

  it('validates a malformed code without calling signIn', async () => {
    const client = {
      ...unavailableAuthClient,
      signIn: vi.fn(async () => sessionFor('user-1')),
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <OtpVerificationScreen
          phone={PHONE}
          navigation={navigation()}
          authError={null}
        />
      </AuthProvider>,
    );
    await typeInto(root, { accessibilityLabel: 'OTP' }, '12');
    await press(root, { accessibilityLabel: 'Verify code' });
    expect(extractText(root.toJSON())).toContain(
      'Enter the code you received.',
    );
    expect(client.signIn).not.toHaveBeenCalled();
  });

  it('verifies the code and signs in with the phone + otp', async () => {
    const client = {
      ...unavailableAuthClient,
      signIn: vi.fn(async () => sessionFor('user-1')),
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <OtpVerificationScreen
          phone={PHONE}
          navigation={navigation()}
          authError={null}
        />
      </AuthProvider>,
    );
    await typeInto(root, { accessibilityLabel: 'OTP' }, '123456');
    await press(root, { accessibilityLabel: 'Verify code' });
    await flushAsync();

    expect(client.signIn).toHaveBeenCalledWith(PHONE, '123456');
  });

  it('surfaces the generic normalized message when verification fails', async () => {
    const client = {
      ...unavailableAuthClient,
      signIn: vi.fn(async () => {
        throw new MobileError('authentication', 'Unable to authenticate');
      }),
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <OtpVerificationScreen
          phone={PHONE}
          navigation={navigation()}
          authError={null}
        />
      </AuthProvider>,
    );
    await typeInto(root, { accessibilityLabel: 'OTP' }, '000000');
    await press(root, { accessibilityLabel: 'Verify code' });
    await flushAsync();

    expect(extractText(root.toJSON())).toContain('Authentication failed');
  });

  it('requests a fresh OTP via the resend action', async () => {
    const client = {
      ...unavailableAuthClient,
      requestOtp: vi.fn(async () => undefined),
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <OtpVerificationScreen
          phone={PHONE}
          navigation={navigation()}
          authError={null}
        />
      </AuthProvider>,
    );
    await press(root, { accessibilityLabel: 'Resend OTP' });
    await flushAsync();

    expect(client.requestOtp).toHaveBeenCalledWith(PHONE);
    expect(extractText(root.toJSON())).toContain('Code sent');
  });

  it('returns to the phone entry via goBack', async () => {
    const nav = navigation();
    const root = await renderAndSettle(
      <AuthProvider client={unavailableAuthClient}>
        <OtpVerificationScreen
          phone={PHONE}
          navigation={nav}
          authError={null}
        />
      </AuthProvider>,
    );
    await press(root, { accessibilityLabel: 'Change phone number' });

    expect(nav.goBack).toHaveBeenCalled();
  });
});
