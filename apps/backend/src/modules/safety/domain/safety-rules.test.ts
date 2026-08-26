/**
 * Unit tests for the Phase 3.24 safety domain rules.
 *
 * Pure predicates/constants — no database. Verifies the self-report/
 * self-block guard and the DECIDED rate-limit constants (5 reports per
 * rolling 24h, Product owner decision, 2026-08-21).
 */
import { describe, expect, it } from 'vitest';
import {
  REPORT_RATE_LIMIT_MAX,
  REPORT_RATE_LIMIT_WINDOW_HOURS,
  REPORT_RATE_LIMIT_WINDOW_MS,
  isSelfTarget,
} from './safety-rules.js';

describe('isSelfTarget', () => {
  it('is true when the actor and target are the same user', () => {
    expect(isSelfTarget('user-1', 'user-1')).toBe(true);
  });

  it('is false for two different users', () => {
    expect(isSelfTarget('user-1', 'user-2')).toBe(false);
  });
});

describe('report rate-limit constants (§11 — DECIDED, 2026-08-21)', () => {
  it('is exactly 5 reports per rolling 24-hour window', () => {
    expect(REPORT_RATE_LIMIT_MAX).toBe(5);
    expect(REPORT_RATE_LIMIT_WINDOW_HOURS).toBe(24);
  });

  it('derives the window in milliseconds from the hour constant', () => {
    expect(REPORT_RATE_LIMIT_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});
