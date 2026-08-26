import { describe, expect, it, vi } from 'vitest';
import type { ApiClient, ApiRequestOptions } from '../api/client';
import { createSafetyApi } from './api';
import { activeBlockDto, blockDto, reportDto } from '../../tests/fixtures';

/** A deterministic fake client that records calls and resolves per-path. */
function fakeClient(responses: Record<string, unknown>): {
  client: ApiClient;
  calls: Array<{ path: string; options?: ApiRequestOptions }>;
} {
  const calls: Array<{ path: string; options?: ApiRequestOptions }> = [];
  const request = vi.fn(
    async (path: string, options?: ApiRequestOptions): Promise<unknown> => {
      calls.push({ path, options });
      if (!(path in responses)) {
        throw new Error(`fakeClient: no response for ${path}`);
      }
      return responses[path];
    },
  );
  const client: ApiClient = {
    request: request as unknown as ApiClient['request'],
  };
  return { client, calls };
}

describe('SafetyApi', () => {
  it('creates a report at POST /reports with the reason/detail/rideId', async () => {
    const { client, calls } = fakeClient({ '/reports': reportDto() });
    const api = createSafetyApi(client);
    const result = await api.createReport({
      reportedUserId: 'user-2',
      reason: 'HARASSMENT',
      detail: 'was rude at pickup',
      rideId: 'ride-1',
    });
    expect(calls[0].path).toBe('/reports');
    expect(calls[0].options?.method).toBe('POST');
    expect(calls[0].options?.body).toEqual({
      reportedUserId: 'user-2',
      reason: 'HARASSMENT',
      detail: 'was rude at pickup',
      rideId: 'ride-1',
    });
    expect(result.id).toBe('report-1');
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it('creates a report without optional detail/rideId', async () => {
    const { client, calls } = fakeClient({ '/reports': reportDto() });
    const api = createSafetyApi(client);
    await api.createReport({ reportedUserId: 'user-2', reason: 'OTHER' });
    expect(calls[0].options?.body).toEqual({
      reportedUserId: 'user-2',
      reason: 'OTHER',
      detail: undefined,
      rideId: undefined,
    });
  });

  it('lists the caller’s filed reports at GET /reports/mine', async () => {
    const { client, calls } = fakeClient({
      '/reports/mine': [reportDto()],
    });
    const api = createSafetyApi(client);
    const reports = await api.listMyReports();
    expect(calls[0].path).toBe('/reports/mine');
    expect(calls[0].options?.method).toBeUndefined();
    expect(reports).toHaveLength(1);
    expect(reports[0].id).toBe('report-1');
  });

  it('creates a block at POST /blocks', async () => {
    const { client, calls } = fakeClient({ '/blocks': blockDto() });
    const api = createSafetyApi(client);
    const result = await api.createBlock({ blockedUserId: 'user-2' });
    expect(calls[0].path).toBe('/blocks');
    expect(calls[0].options?.method).toBe('POST');
    expect(calls[0].options?.body).toEqual({ blockedUserId: 'user-2' });
    expect(result.blockedUserId).toBe('user-2');
    expect(result.unblockedAt).toBeNull();
  });

  it('removes a block at DELETE /blocks/:blockedUserId', async () => {
    const { client, calls } = fakeClient({ '/blocks/user-2': undefined });
    const api = createSafetyApi(client);
    await api.removeBlock({ blockedUserId: 'user-2' });
    expect(calls[0].path).toBe('/blocks/user-2');
    expect(calls[0].options?.method).toBe('DELETE');
  });

  it('encodes the blocked user id in the unblock path', async () => {
    const { client, calls } = fakeClient({
      '/blocks/user%40example': undefined,
    });
    const api = createSafetyApi(client);
    await api.removeBlock({ blockedUserId: 'user@example' });
    expect(calls[0].path).toBe('/blocks/user%40example');
  });

  it('lists active blocks at GET /blocks/mine', async () => {
    const { client, calls } = fakeClient({
      '/blocks/mine': [activeBlockDto()],
    });
    const api = createSafetyApi(client);
    const blocks = await api.listMyBlocks();
    expect(calls[0].path).toBe('/blocks/mine');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].blockedUserName).toBe('Bo');
  });
});
