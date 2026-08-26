/**
 * LocationSearch component tests (Phase 3.20). The geocoding provider is
 * injected (fake), so no network/native code runs. Pins debounce, result
 * rendering, disabled fail-closed behavior, and error normalization.
 */
import { describe, expect, it, vi } from 'vitest';
import { MobileError } from '../api/errors';
import { fakeGeocodingProvider } from '../../tests/fixtures';
import {
  renderAndSettle,
  typeInto,
  findAll,
  flushAsync,
} from '../../tests/render';
import { LocationSearch } from './location-search';

async function settleAfterTyping(
  root: Awaited<ReturnType<typeof renderAndSettle>>,
  value: string,
) {
  await typeInto(root, { accessibilityLabel: 'Search for a place' }, value);
  await flushAsync();
}

describe('LocationSearch', () => {
  it('renders forward-geocoding results and selects on tap', async () => {
    const provider = fakeGeocodingProvider({
      forward: [
        { latitude: 12.9716, longitude: 77.5946, label: 'MG Road, Bengaluru' },
      ],
    });
    const onSelect = vi.fn();
    const root = await renderAndSettle(
      <LocationSearch
        geocodingProvider={provider}
        onSelect={onSelect}
        debounceMs={0}
      />,
    );
    await settleAfterTyping(root, 'MG Road');
    expect(provider.forwardGeocode).toHaveBeenCalledWith('MG Road');
    await flushAsync();
    const results = root.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        typeof node.props.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.startsWith('Search result:'),
    );
    expect(results.length).toBe(1);
    await flushAsync();
    const result = results[0];
    const onPress = result.props.onPress as () => void;
    onPress();
    expect(onSelect).toHaveBeenCalledWith({
      latitude: 12.9716,
      longitude: 77.5946,
      label: 'MG Road, Bengaluru',
    });
  });

  it('waits for the debounce before firing a search', async () => {
    const provider = fakeGeocodingProvider({ forward: [] });
    const root = await renderAndSettle(
      <LocationSearch
        geocodingProvider={provider}
        onSelect={vi.fn()}
        debounceMs={10_000}
      />,
    );
    await typeInto(
      root,
      { accessibilityLabel: 'Search for a place' },
      'MG Road',
    );
    await Promise.resolve();
    expect(provider.forwardGeocode).not.toHaveBeenCalled();
  });

  it('clears results when the query drops below the minimum length', async () => {
    const provider = fakeGeocodingProvider({
      forward: [{ latitude: 1, longitude: 2, label: 'One' }],
    });
    const root = await renderAndSettle(
      <LocationSearch
        geocodingProvider={provider}
        onSelect={vi.fn()}
        debounceMs={0}
        minQueryLength={2}
      />,
    );
    await settleAfterTyping(root, 'MG');
    await flushAsync();
    expect(
      root.root.findAll(
        (node) =>
          typeof node.type === 'string' &&
          typeof node.props.accessibilityLabel === 'string' &&
          node.props.accessibilityLabel.startsWith('Search result:'),
      ).length,
    ).toBe(1);
    await typeInto(root, { accessibilityLabel: 'Search for a place' }, 'M');
    await flushAsync();
    expect(
      root.root.findAll(
        (node) =>
          typeof node.type === 'string' &&
          typeof node.props.accessibilityLabel === 'string' &&
          node.props.accessibilityLabel.startsWith('Search result:'),
      ).length,
    ).toBe(0);
  });

  it('renders a normalized error message on provider failure', async () => {
    const provider = fakeGeocodingProvider({
      error: new MobileError('external-service', 'Geocoding is unavailable'),
    });
    const root = await renderAndSettle(
      <LocationSearch
        geocodingProvider={provider}
        onSelect={vi.fn()}
        debounceMs={0}
      />,
    );
    await settleAfterTyping(root, 'MG Road');
    await flushAsync();
    const text = root.root
      .findAllByType('Text' as never)
      .map((node) => String(node.props.children))
      .join(' ');
    expect(text).toContain('temporarily unavailable');
  });

  it('disables the input when the provider is fail-closed (no Maps key)', async () => {
    const onSelect = vi.fn();
    const root = await renderAndSettle(
      <LocationSearch
        geocodingProvider={fakeGeocodingProvider({ id: 'fail-closed' })}
        onSelect={onSelect}
      />,
    );
    const input = findAll(root, {
      accessibilityLabel: 'Search for a place',
    })[0];
    expect(input.props.editable).toBe(false);
    const text = root.root
      .findAllByType('Text' as never)
      .map((node) => String(node.props.children))
      .join(' ');
    expect(text).toContain('no Maps provider');
  });
});
