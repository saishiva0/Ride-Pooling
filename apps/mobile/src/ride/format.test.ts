import { describe, expect, it } from 'vitest';
import { formatDateTime, formatDistance, formatPricePerKm } from './format';

describe('formatDateTime', () => {
  it('formats a UTC date deterministically', () => {
    const date = new Date('2026-08-18T10:05:00.000Z');
    expect(formatDateTime(date)).toBe('Aug 18, 2026 · 10:05');
  });

  it('pads hours and minutes to two digits', () => {
    const date = new Date('2026-01-02T09:07:00.000Z');
    expect(formatDateTime(date)).toBe('Jan 2, 2026 · 09:07');
  });
});

describe('formatDistance', () => {
  it('formats meters below one kilometer', () => {
    expect(formatDistance(850)).toBe('850 m');
  });

  it('formats whole kilometers with one decimal', () => {
    expect(formatDistance(1000)).toBe('1.0 km');
  });

  it('formats fractional kilometers with one decimal', () => {
    expect(formatDistance(1200)).toBe('1.2 km');
  });
});

describe('formatPricePerKm', () => {
  it('formats the per-kilometer price with two decimals', () => {
    expect(formatPricePerKm(2.5)).toBe('2.50 /km');
    expect(formatPricePerKm(1)).toBe('1.00 /km');
  });
});
