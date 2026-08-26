/**
 * `useAsync` hook (Phase 3.13 — MOBILE FOUNDATION, §17).
 *
 * The smallest bridge between an async operation and the `AsyncState` model:
 * call `run()` to start the operation; the returned `state` transitions
 * idle → loading → success | error. Errors are normalized to `MobileError`
 * (never rethrown — the UI consumes `state.error`).
 */
import { useCallback, useState } from 'react';
import { toMobileError } from '../api/errors';
import { idleAsyncState, type AsyncState } from '../state/async';

export interface UseAsyncResult<T> {
  state: AsyncState<T>;
  /** Runs the operation once; safe to call again (re-runs from loading). */
  run: () => Promise<void>;
}

export function useAsync<T>(operation: () => Promise<T>): UseAsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>(idleAsyncState);

  const run = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await operation();
      setState({ status: 'success', data });
    } catch (err) {
      setState({ status: 'error', error: toMobileError(err) });
    }
  }, [operation]);

  return { state, run };
}
