/**
 * Deterministic `react-native-maps` mock for tests (Phase 3.20).
 *
 * The native Google/Apple map SDKs cannot run in a plain Node vitest
 * environment, so tests alias `react-native-maps` to this file (see
 * `vitest.config.ts`). Each export renders a lightweight host component that
 * forwards props unchanged so tests can assert rendered markers, polylines,
 * and the map region via the existing render helpers. This file is test
 * infrastructure ONLY — Metro resolves the real native module at runtime.
 */
import { View } from 'react-native';
import { createElement, type ComponentType } from 'react';

export const PROVIDER_GOOGLE = 'google';

/** Props mirroring the subset of `react-native-maps` used by RidePool. */
export interface MapViewProps {
  children?: unknown;
  initialRegion?: unknown;
  onPress?: (event: unknown) => void;
  onMapReady?: () => void;
  provider?: string;
  showsUserLocation?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}

export interface MarkerProps {
  coordinate?: { latitude: number; longitude: number };
  title?: string;
  description?: string;
  identifier?: string;
  onPress?: () => void;
  pinColor?: string;
  accessibilityLabel?: string;
}

export interface PolylineProps {
  coordinates?: Array<{ latitude: number; longitude: number }>;
  strokeColor?: string;
  strokeWidth?: number;
  geodesic?: boolean;
  testID?: string;
}

export const MapView = ({ children, ...props }: MapViewProps) =>
  createElement(View as ComponentType<Record<string, unknown>>, {
    ...props,
    children,
  });

export const Marker = (props: MarkerProps) =>
  createElement(View as ComponentType<Record<string, unknown>>, {
    ...(props as unknown as Record<string, unknown>),
  });

export const Polyline = (props: PolylineProps) =>
  createElement(View as ComponentType<Record<string, unknown>>, {
    ...(props as unknown as Record<string, unknown>),
  });

export default MapView;
