/**
 * AuthNavigator tests (Phase 3.18 — OD-005 resolved).
 *
 * The public boundary sequences the phone → OTP flow and surfaces any
 * authentication error from the auth state. It never touches credentials.
 */
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/auth-provider';
import { unavailableAuthClient } from '../auth/auth-client';
import {
  renderAndSettle,
  extractText,
  press,
  typeInto,
  flushAsync,
} from '../../tests/render';
import { AuthNavigator } from './auth-navigator';

describe('AuthNavigator (public auth boundary)', () => {
  it('renders the phone entry screen by default', async () => {
    const root = await renderAndSettle(
      <AuthProvider client={unavailableAuthClient}>
        <AuthNavigator />
      </AuthProvider>,
    );
    const text = extractText(root.toJSON());
    expect(text).toContain('Enter your phone number');
    expect(text).toContain('Send OTP');
  });

  it('advances to the OTP screen after a successful phone submit', async () => {
    const client = {
      ...unavailableAuthClient,
      requestOtp: vi.fn(async () => undefined),
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <AuthNavigator />
      </AuthProvider>,
    );
    await typeInto(root, { accessibilityLabel: 'Phone number' }, '9876543210');
    await press(root, { accessibilityLabel: 'Send OTP' });
    await flushAsync();

    const text = extractText(root.toJSON());
    expect(text).toContain('Enter the code');
    expect(text).toContain('9876543210');
  });

  it('can go back from the OTP screen to the phone entry', async () => {
    const client = {
      ...unavailableAuthClient,
      requestOtp: vi.fn(async () => undefined),
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <AuthNavigator />
      </AuthProvider>,
    );
    await typeInto(root, { accessibilityLabel: 'Phone number' }, '9876543210');
    await press(root, { accessibilityLabel: 'Send OTP' });
    await flushAsync();
    await press(root, { accessibilityLabel: 'Change phone number' });

    expect(extractText(root.toJSON())).toContain('Enter your phone number');
  });

  it('keeps the phone entry in place when an auth error is pending', async () => {
    const client = {
      ...unavailableAuthClient,
      requestOtp: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const root = await renderAndSettle(
      <AuthProvider client={client}>
        <AuthNavigator />
      </AuthProvider>,
    );
    await typeInto(root, { accessibilityLabel: 'Phone number' }, '9876543210');
    await press(root, { accessibilityLabel: 'Send OTP' });
    await flushAsync();

    const text = extractText(root.toJSON());
    expect(text).toContain('Enter your phone number');
    expect(text).not.toContain('Enter the code');
  });
});
