/**
 * Minimal `react-native` mock for deterministic render tests (Phase 3.13).
 *
 * React Native components cannot be imported in a plain Node vitest
 * environment, so tests alias `react-native` to this file (see
 * `vitest.config.ts`). It provides just enough surface for the foundation
 * components under test: View/Text/SafeAreaView render their children and
 * `StyleSheet.create` is the identity (styles are plain objects).
 *
 * This mock is test infrastructure ONLY — it is never used by the app at
 * runtime (Metro resolves the real `react-native`). No RN internals are
 * mocked beyond what the foundation renders.
 */
import { createElement } from 'react';
import type { ReactNode } from 'react';

interface MockComponentProps {
  children?: ReactNode;
  [key: string]: unknown;
}

function makeComponent(displayName: string) {
  function Component({ children, ...props }: MockComponentProps) {
    return createElement(displayName, props, children);
  }
  Component.displayName = displayName;
  return Component;
}

export const View = makeComponent('View');
export const Text = makeComponent('Text');
export const SafeAreaView = makeComponent('SafeAreaView');
export const Pressable = makeComponent('Pressable');
export const ScrollView = makeComponent('ScrollView');
export const TextInput = makeComponent('TextInput');
export const ActivityIndicator = makeComponent('ActivityIndicator');

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
};

export const Platform = {
  OS: 'ios',
  select: (spec: { ios?: unknown; default?: unknown }): unknown =>
    spec.ios ?? spec.default ?? null,
};
