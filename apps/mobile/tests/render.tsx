/**
 * Deterministic render helpers for mobile component tests (Phase 3.13).
 *
 * Built on the official `react-test-renderer`: no DOM, no native runtime,
 * fully deterministic. `renderAndSettle` renders a component and flushes the
 * microtask queue so session-restore/async state settles inside `act`.
 * `extractText` flattens the rendered JSON tree to the visible text.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ReactElement } from 'react';

type JsonNode =
  | string
  | number
  | boolean
  | null
  | { type?: unknown; props?: unknown; children?: unknown }
  | JsonNode[];

export async function renderAndSettle(
  element: ReactElement,
): Promise<ReactTestRenderer> {
  let root: ReactTestRenderer | undefined;
  await act(async () => {
    root = create(element);
    // Flush the session-restore / async-state promise chains so all state
    // updates land inside `act` (deterministic, warning-free).
    await Promise.resolve();
    await Promise.resolve();
  });
  if (!root) {
    throw new Error('renderAndSettle: renderer was not created');
  }
  return root;
}

/**
 * Flushes several microtask turns inside `act` so multi-`await` async chains
 * (e.g. permission → location) fully settle before assertions. Used by tests
 * after a `press` that drives a longer promise pipeline.
 */
export async function flushAsync(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 12; turn += 1) {
      await Promise.resolve();
    }
  });
}

/** Flattens a react-test-renderer JSON tree to the concatenated text. */
export function extractText(json: JsonNode | JsonNode[] | undefined): string {
  if (json === null || json === undefined || typeof json === 'boolean') {
    return '';
  }
  if (typeof json === 'string') {
    return json;
  }
  if (typeof json === 'number') {
    return String(json);
  }
  if (Array.isArray(json)) {
    return json.map(extractText).join('');
  }
  return extractText(json.children as JsonNode | JsonNode[] | undefined);
}

/** Matches a test instance's props against the expected props (regex values
 * match string props; other values use deep equality). */
function matchesProps(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  return Object.entries(expected).every(([key, value]) => {
    if (value instanceof RegExp && typeof actual[key] === 'string') {
      return value.test(actual[key] as string);
    }
    return actual[key] === value;
  });
}

/** Finds host test instances whose props match; throws when none match. */
export function findAll(
  root: ReactTestRenderer,
  props: Record<string, unknown>,
): Array<{ props: Record<string, unknown> }> {
  const found = root.root.findAll(
    (node) => typeof node.type === 'string' && matchesProps(node.props, props),
  );
  if (found.length === 0) {
    throw new Error(
      `No instances found with props: ${JSON.stringify(props, (key, value) =>
        value instanceof RegExp ? String(value) : value,
      )}`,
    );
  }
  return found;
}

/**
 * Finds a single test instance by props and triggers its `onPress`, flushing
 * the microtask queue so async state updates land inside `act`. Throws when no
 * node or more than one node matches.
 */
export async function press(
  root: ReactTestRenderer,
  props: Record<string, unknown>,
): Promise<void> {
  const found = findAll(root, props);
  if (found.length > 1) {
    throw new Error(
      `press: expected one match but found ${found.length} for props ${JSON.stringify(
        props,
        (key, value) => (value instanceof RegExp ? String(value) : value),
      )}`,
    );
  }
  const node = found[0];
  const onPress = node.props.onPress as (() => void) | undefined;
  await act(async () => {
    onPress?.();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Finds a single test instance by props and triggers `onChangeText` (simulating
 * typing into a `TextInput`).
 */
export async function typeInto(
  root: ReactTestRenderer,
  props: Record<string, unknown>,
  value: string,
): Promise<void> {
  const found = findAll(root, props);
  if (found.length > 1) {
    throw new Error(
      `typeInto: expected one match but found ${found.length} for props ${JSON.stringify(
        props,
        (key, val) => (val instanceof RegExp ? String(val) : val),
      )}`,
    );
  }
  await act(async () => {
    const onChangeText = found[0].props.onChangeText as
      ((value: string) => void) | undefined;
    onChangeText?.(value);
  });
}
