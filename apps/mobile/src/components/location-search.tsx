/**
 * LocationSearch — forward-geocoding address search (Phase 3.20 — GOOGLE MAPS
 * & LOCATION INTEGRATION).
 *
 * As the user types, the query is debounced and sent through the provider-
 * neutral `GeocodingProvider` port. Results render as tappable rows that
 * resolve to a `LocationReference`. Failures render a normalized message; with
 * no provider configured (`unavailable`) the search is disabled with a clear
 * note so the app never looks like it's silently doing nothing.
 *
 * Deterministic and testable: the provider is injected (tests use fakes); the
 * debounce is configurable for tests.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { mobileErrorMessage, toMobileError } from '../api/errors';
import {
  failClosedGeocodingProvider,
  type GeocodingProvider,
} from '../location/geocoding';
import type { LocationReference } from '../location/location.types';
import { colors, spacing, typography } from '../theme';

export interface LocationSearchProps {
  /** The geocoding provider. Defaults to the fail-closed provider. */
  geocodingProvider?: GeocodingProvider;
  /** Called with the resolved location when a result is chosen. */
  onSelect: (location: LocationReference) => void;
  /** Minimum query length before searching. Default 2. */
  minQueryLength?: number;
  /** Debounce before firing a search. Default 350ms. */
  debounceMs?: number;
  /** Placeholder for the search input. */
  placeholder?: string;
  /** Accessibility label for the input. */
  inputLabel?: string;
}

export function LocationSearch({
  geocodingProvider = failClosedGeocodingProvider,
  onSelect,
  minQueryLength = 2,
  debounceMs = 350,
  placeholder = 'Search for a place',
  inputLabel = 'Search for a place',
}: LocationSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocationReference[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const requestCounter = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    setError(null);
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    const trimmed = value.trim();
    if (trimmed.length < minQueryLength) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      const counter = requestCounter.current + 1;
      requestCounter.current = counter;
      void geocodingProvider
        .forwardGeocode(trimmed)
        .then((locations) => {
          if (requestCounter.current === counter) {
            setResults(locations);
            setSearching(false);
          }
        })
        .catch((err: unknown) => {
          if (requestCounter.current === counter) {
            setError(mobileErrorMessage(toMobileError(err)));
            setResults([]);
            setSearching(false);
          }
        });
    }, debounceMs);
  };

  const disabled = geocodingProvider.id === 'fail-closed';

  return (
    <View style={styles.container}>
      <TextInput
        accessibilityLabel={inputLabel}
        value={query}
        onChangeText={handleChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        editable={!disabled}
        style={[styles.input, disabled ? styles.inputDisabled : null]}
      />
      {disabled && (
        <Text style={styles.note}>
          Place search is unavailable (no Maps provider configured).
        </Text>
      )}
      {searching && <Text style={styles.note}>Searching…</Text>}
      {error !== null && <Text style={styles.error}>{error}</Text>}
      {results.map((location, index) => (
        <Pressable
          key={`${location.latitude}-${location.longitude}-${index}`}
          accessibilityRole="button"
          accessibilityLabel={`Search result: ${location.label ?? 'location'}`}
          onPress={() => onSelect(location)}
          style={styles.result}
        >
          <Text style={styles.resultLabel}>
            {location.label ?? `${location.latitude}, ${location.longitude}`}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    padding: spacing.sm,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  inputDisabled: {
    color: colors.textSecondary,
  },
  note: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  error: {
    ...typography.caption,
    color: colors.danger,
    marginBottom: spacing.xs,
  },
  result: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
});
