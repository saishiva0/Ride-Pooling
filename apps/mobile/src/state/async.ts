/**
 * Typed async state model (Phase 3.13 — MOBILE FOUNDATION, §17).
 *
 * The minimum abstraction needed for predictable asynchronous UI:
 *
 *   idle → loading → success | error
 *
 * No global store, no state-management framework — future screens compose
 * this small model (usually through `useAsync` in `src/hooks/`). Errors are
 * always normalized `MobileError` values; raw transport errors never appear
 * in UI state.
 */
import type { MobileError } from '../api/errors';

export type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: MobileError };

export function idleAsyncState<T>(): AsyncState<T> {
  return { status: 'idle' };
}

export function isIdle<T>(state: AsyncState<T>): state is { status: 'idle' } {
  return state.status === 'idle';
}

export function isLoading<T>(
  state: AsyncState<T>,
): state is { status: 'loading' } {
  return state.status === 'loading';
}

export function isSuccess<T>(
  state: AsyncState<T>,
): state is { status: 'success'; data: T } {
  return state.status === 'success';
}

export function isError<T>(
  state: AsyncState<T>,
): state is { status: 'error'; error: MobileError } {
  return state.status === 'error';
}
