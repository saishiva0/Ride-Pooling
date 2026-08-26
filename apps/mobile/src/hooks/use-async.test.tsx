import { useEffect } from 'react';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { renderAndSettle, extractText } from '../../tests/render';
import { useAsync } from './use-async';

interface HarnessProps {
  operation: () => Promise<string>;
}

function Harness({ operation }: HarnessProps) {
  const { state, run } = useAsync(operation);
  useEffect(() => {
    void run();
  }, [run]);
  const rendered =
    state.status === 'success'
      ? `success:${state.data}`
      : state.status === 'error'
        ? `error:${state.error.kind}`
        : state.status;
  return <Text>{rendered}</Text>;
}

describe('useAsync', () => {
  it('transitions idle → loading → success with the resolved data', async () => {
    const root = await renderAndSettle(
      <Harness operation={async () => 'hello'} />,
    );
    expect(extractText(root.toJSON())).toBe('success:hello');
  });

  it('transitions to error with a normalized MobileError on failure', async () => {
    const root = await renderAndSettle(
      <Harness
        operation={async () => {
          throw new TypeError('fetch failed');
        }}
      />,
    );
    expect(extractText(root.toJSON())).toBe('error:network');
  });

  it('normalizes backend-style errors without leaking raw internals', async () => {
    const root = await renderAndSettle(
      <Harness
        operation={async () => {
          throw new Error('secret internal detail');
        }}
      />,
    );
    expect(extractText(root.toJSON())).toBe('error:unknown');
  });

  it('invokes the operation exactly once per run', async () => {
    const operation = vi.fn(async () => 'value');
    await renderAndSettle(<Harness operation={operation} />);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
