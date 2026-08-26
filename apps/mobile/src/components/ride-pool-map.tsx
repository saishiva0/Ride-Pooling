/**
 * RidePoolMap — the reusable, provider-neutral map component (Phase 3.20 —
 * GOOGLE MAPS & LOCATION INTEGRATION).
 *
 * The ONLY component in the app that renders `react-native-maps`. It consumes
 * RidePool's own models (`Coordinate`, `LocationReference`, `RouteResult`,
 * `LineStringGeometry`) and translates them to the map SDK — no other component
 * imports a map SDK. Screens use this component and the `LocationPicker`/
 * `LocationSearch`/`RoutePreview` companions; they never touch Google Maps
 * APIs or react-native-maps directly.
 *
 * States rendered deterministically:
 * - `unavailable` → an explanatory placeholder (no fabricated map)
 * - `loading`     → a loading overlay
 * - `error`       → the normalized error message
 * - ready         → the map with markers, the selected location, and an
 *   optional route polyline
 *
 * Note: a real Google map requires the native SDK and a configured
 * `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (development build on iOS; see
 * `docs/development/phase-3-20-notes.md`). With no key the component fails
 * closed — the caller renders the unavailable state, never a blank map.
 */
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { mobileErrorMessage, type MobileError } from '../api/errors';
import { colors, spacing, typography } from '../theme';
import type { Coordinate, RouteResult } from '../location/location.types';

/** A marker rendered on the map, described in RidePool terms. */
export interface RidePoolMapMarker {
  id: string;
  coordinate: Coordinate;
  /** Semantic role drives pin color (no invented palette). */
  kind: 'current-location' | 'pickup' | 'drop-off' | 'ride';
  title?: string;
  description?: string;
  onPress?: () => void;
}

export interface RidePoolMapProps {
  /** The initial visible region. */
  initialCoordinate?: Coordinate;
  /** Markers to render. */
  markers?: RidePoolMapMarker[];
  /** A highlighted coordinate (e.g. the selected pickup) without a marker. */
  selectedCoordinate?: Coordinate;
  /** A route to draw as a polyline (geometry is [lng, lat] LineString). */
  route?: RouteResult | null;
  /** True while the map is still loading. */
  loading?: boolean;
  /** Normalized provider/map error to render. */
  error?: MobileError | null;
  /** True when no map provider is configured — render the placeholder. */
  unavailable?: boolean;
  /** Called with the coordinate of a map tap (pickup selection). */
  onLocationSelected?: (coordinate: Coordinate) => void;
  /** Called once the map has finished loading its tiles. */
  onMapReady?: () => void;
  accessibilityLabel?: string;
  style?: object;
}

const MARKER_PIN: Record<RidePoolMapMarker['kind'], string> = {
  'current-location': '#1A73E8',
  pickup: '#2E7D32',
  'drop-off': '#C5221F',
  ride: '#ED6C02',
};

/** Converts a [lng, lat] LineString to react-native-maps [lat, lng] points. */
function geometryToCoordinates(
  geometry: NonNullable<RouteResult['geometry']>,
): Array<{ latitude: number; longitude: number }> {
  return geometry.coordinates.map(([longitude, latitude]) => ({
    latitude,
    longitude,
  }));
}

export function RidePoolMap({
  initialCoordinate,
  markers = [],
  selectedCoordinate,
  route,
  loading = false,
  error = null,
  unavailable = false,
  onLocationSelected,
  onMapReady,
  accessibilityLabel = 'Map',
  style,
}: RidePoolMapProps) {
  if (unavailable) {
    return (
      <View
        style={[styles.container, style]}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="summary"
      >
        <Text style={styles.message}>
          The map is unavailable (no Maps provider is configured).
        </Text>
      </View>
    );
  }

  const handlePress = (event: {
    nativeEvent?: { coordinate?: { latitude: number; longitude: number } };
  }) => {
    const coordinate = event.nativeEvent?.coordinate;
    if (coordinate) {
      onLocationSelected?.({
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
      });
    }
  };

  const initialRegion = initialCoordinate
    ? {
        latitude: initialCoordinate.latitude,
        longitude: initialCoordinate.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : undefined;

  return (
    <View
      style={[styles.container, style]}
      accessibilityLabel={accessibilityLabel}
    >
      <MapView
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion}
        onPress={handlePress}
        onMapReady={onMapReady}
        testID="ride-pool-map"
        style={styles.map}
      >
        {selectedCoordinate !== undefined && (
          <Marker
            coordinate={{
              latitude: selectedCoordinate.latitude,
              longitude: selectedCoordinate.longitude,
            }}
            identifier="selected-location"
            accessibilityLabel="Selected location"
            pinColor={MARKER_PIN['pickup']}
          />
        )}
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            identifier={marker.id}
            coordinate={{
              latitude: marker.coordinate.latitude,
              longitude: marker.coordinate.longitude,
            }}
            title={marker.title}
            description={marker.description}
            pinColor={MARKER_PIN[marker.kind]}
            onPress={marker.onPress}
            accessibilityLabel={`Marker: ${marker.title ?? marker.id}`}
          />
        ))}
        {route?.geometry && (
          <Polyline
            coordinates={geometryToCoordinates(route.geometry)}
            strokeColor={colors.accent}
            strokeWidth={3}
            testID="route-polyline"
          />
        )}
      </MapView>

      {loading && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>Loading map…</Text>
        </View>
      )}
      {error !== null && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>{mobileErrorMessage(error)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 240,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  map: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  overlayText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    padding: spacing.md,
    textAlign: 'center',
  },
});
