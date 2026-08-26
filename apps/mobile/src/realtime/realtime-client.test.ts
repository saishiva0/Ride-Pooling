import { describe, expect, it } from 'vitest';
import {
  RealtimeUnavailableError,
  unavailableRealtimeClient,
} from './realtime-client';

describe('unavailableRealtimeClient (fail-closed default)', () => {
  it('starts disconnected', () => {
    expect(unavailableRealtimeClient.connectionState).toBe('disconnected');
  });

  it('throws RealtimeUnavailableError from connect() — no transport, no network', async () => {
    await expect(unavailableRealtimeClient.connect()).rejects.toBeInstanceOf(
      RealtimeUnavailableError,
    );
  });

  it('throws RealtimeUnavailableError from subscribe() — fail closed', () => {
    expect(() =>
      unavailableRealtimeClient.subscribe('RIDE_REQUESTED', () => {}),
    ).toThrow(RealtimeUnavailableError);
  });

  it('resolves disconnect() as a safe no-op', async () => {
    await expect(
      unavailableRealtimeClient.disconnect(),
    ).resolves.toBeUndefined();
  });

  it('never fabricates a connection or a userId', async () => {
    // No connect can succeed, so no room/recipient state can ever be invented.
    const error = await unavailableRealtimeClient
      .connect()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RealtimeUnavailableError);
  });
});
