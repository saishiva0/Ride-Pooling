import { describe, expect, it, vi } from 'vitest';
import {
  renderAndSettle,
  extractText,
  press,
  findAll,
} from '../../tests/render';
import { rideSummary } from '../../tests/fixtures';
import { RideCard } from './ride-card';

describe('RideCard', () => {
  it('renders the route, departure, seats, price and distance', async () => {
    const root = await renderAndSettle(
      <RideCard ride={rideSummary()} onPress={() => {}} />,
    );
    const text = extractText(root.toJSON());
    expect(text).toContain('MG Road → Koramangala');
    expect(text).toContain('Aug 18, 2026 · 10:05');
    expect(text).toContain('by Ava');
    expect(text).toContain('3 of 4 seats');
    expect(text).toContain('2.50 /km');
    expect(text).toContain('1.2 km');
  });

  it('falls back to coordinates when labels are missing', async () => {
    const root = await renderAndSettle(
      <RideCard
        ride={rideSummary({
          pickupLocation: {
            id: 'loc-1',
            latitude: 1,
            longitude: 2,
            label: null,
          },
        })}
        onPress={() => {}}
      />,
    );
    expect(extractText(root.toJSON())).toContain('1, 2 → Koramangala');
  });

  it('triggers onPress and exposes an accessible label', async () => {
    const onPress = vi.fn();
    const root = await renderAndSettle(
      <RideCard ride={rideSummary()} onPress={onPress} />,
    );
    const nodes = findAll(root, {
      accessibilityRole: 'button',
      accessibilityLabel: /Ride by Ava/,
    });
    expect(nodes).toHaveLength(1);
    await press(root, { accessibilityLabel: /Ride by Ava/ });
    expect(onPress).toHaveBeenCalledOnce();
  });
});
