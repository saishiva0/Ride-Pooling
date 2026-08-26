/**
 * RoutePreview component tests (Phase 3.20). Pure presentation: pins the
 * locale-free duration/distance formatting and the accessibility summary.
 */
import { describe, expect, it } from 'vitest';
import { renderAndSettle, extractText } from '../../tests/render';
import { RoutePreview, formatDuration } from './route-preview';

describe('formatDuration', () => {
  it('formats hours, minutes, and seconds deterministically', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(720)).toBe('12m');
    expect(formatDuration(4980)).toBe('1h 23m');
  });
});

describe('RoutePreview', () => {
  it('renders distance and duration', async () => {
    const root = await renderAndSettle(
      <RoutePreview route={{ distanceMeters: 4850, durationSeconds: 602 }} />,
    );
    const text = extractText(root.toJSON());
    expect(text).toContain('Route');
    expect(text).toContain('4.8 km');
    expect(text).toContain('10m');
  });

  it('is summarized for screen readers', async () => {
    const root = await renderAndSettle(
      <RoutePreview route={{ distanceMeters: 850, durationSeconds: 45 }} />,
    );
    const summary = root.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        node.props.accessibilityRole === 'summary',
    );
    expect(summary.length).toBeGreaterThan(0);
  });
});
