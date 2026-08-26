/**
 * Vitest setup (Phase 3.13 — MOBILE FOUNDATION).
 *
 * Enables React's `act` environment so component render tests using
 * `react-test-renderer` behave deterministically (state updates flushed
 * inside `act` with no warnings). No global test doubles live here — mocks
 * are per-test or via the module aliases in `vitest.config.ts`.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
