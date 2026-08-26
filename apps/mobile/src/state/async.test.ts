import { describe, expect, it } from 'vitest';
import { MobileError } from '../api/errors';
import {
  idleAsyncState,
  isError,
  isIdle,
  isLoading,
  isSuccess,
  type AsyncState,
} from './async';

describe('AsyncState model', () => {
  it('starts idle with no data', () => {
    const state = idleAsyncState<string>();
    expect(state).toEqual({ status: 'idle' });
    expect(isIdle(state)).toBe(true);
    expect(isLoading(state)).toBe(false);
    expect(isSuccess(state)).toBe(false);
    expect(isError(state)).toBe(false);
  });

  it('guards each status', () => {
    const loading: AsyncState<string> = { status: 'loading' };
    const success: AsyncState<string> = { status: 'success', data: 'ok' };
    const error: AsyncState<string> = {
      status: 'error',
      error: new MobileError('network', 'Network request failed'),
    };

    expect(isLoading(loading)).toBe(true);
    expect(isSuccess(success)).toBe(true);
    expect(isSuccess(success) && success.data).toBe('ok');
    expect(isError(error)).toBe(true);
    expect(isError(error) && error.error.kind).toBe('network');
  });

  it('carries normalized MobileError values, never raw transport errors', () => {
    const state: AsyncState<never> = {
      status: 'error',
      error: new MobileError('business-rule', 'ride not active', {
        code: 'BUSINESS_RULE_VIOLATION',
      }),
    };
    expect(isError(state) && state.error.kind).toBe('business-rule');
  });
});
