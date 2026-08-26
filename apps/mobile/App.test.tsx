/**
 * Root application render test (Phase 3.13 — MOBILE FOUNDATION, §19;
 * Phase 3.18 — OD-005 resolved).
 *
 * The app shell is deterministic: no network calls, no business features.
 * With the default auth wiring (secure storage unavailable in tests → fail
 * closed) the root settles on the auth boundary, which renders the phone
 * entry screen of the phone + OTP flow.
 */
import { describe, expect, it } from 'vitest';
import App from './App';
import { renderAndSettle, extractText } from './tests/render';

describe('App (application shell)', () => {
  it('starts successfully and renders the deterministic auth boundary', async () => {
    const root = await renderAndSettle(<App />);
    const text = extractText(root.toJSON());
    expect(text).toContain('RidePool');
    expect(text).toContain('Enter your phone number');
  });

  it('never shows authenticated content without a session (fail closed)', async () => {
    const root = await renderAndSettle(<App />);
    expect(extractText(root.toJSON())).not.toContain('Discover rides');
  });
});
