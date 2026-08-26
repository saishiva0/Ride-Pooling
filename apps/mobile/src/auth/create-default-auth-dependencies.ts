/**
 * Default mobile auth wiring (Phase 3.18 — OD-005 resolved;
 * Phase 3.22 — REALTIME PRODUCTIONIZATION).
 *
 * The production composition root for authentication: secure storage + the
 * stored headers provider + the generic API client + the typed auth API +
 * the concrete AuthClient + the concrete RealtimeClient.
 * App.tsx / AuthProvider use this when no explicit client is injected;
 * tests always inject their own (memory storage, fakes).
 *
 * No secrets live in the bundle: the bearer token exists only inside the
 * platform secure store and in the Authorization header of outgoing requests.
 */
import { createApiClient } from '../api/client';
import { loadMobileConfig } from '../config/env';
import { createAuthApi } from './auth-api';
import { createAuthClient, type AuthClient } from './auth-client';
import {
  createStoredAuthHeadersProvider,
  type AuthHeadersProvider,
} from './auth-headers';
import { createSecureSessionStorage } from './storage/secure';
import type { SessionStorage } from './storage/types';
import {
  unavailableRealtimeClient,
  type RealtimeClient,
} from '../realtime/realtime-client';

export interface DefaultAuthDependencies {
  client: AuthClient;
  headersProvider: AuthHeadersProvider;
  storage: SessionStorage;
  realtimeClient: RealtimeClient;
}

export function createDefaultAuthDependencies(): DefaultAuthDependencies {
  const storage = createSecureSessionStorage();
  const headersProvider = createStoredAuthHeadersProvider(storage);
  const config = loadMobileConfig();
  const api = createApiClient({
    baseUrl: config.apiBaseUrl,
    authProvider: headersProvider,
  });
  const client = createAuthClient({ api: createAuthApi(api), storage });
  // Dynamic import of the concrete Socket.io client only — it is the piece
  // with a real risk of circularity; the fail-closed default has none (see
  // realtime-client.ts, which only imports from ./events).
  let realtimeClient: RealtimeClient;
  if (config.realtimeUrl) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSocketRealtimeClient } = require('../realtime/socket-client');
    realtimeClient = createSocketRealtimeClient(
      headersProvider,
      config.realtimeUrl,
    );
  } else {
    realtimeClient = unavailableRealtimeClient;
  }
  return { client, headersProvider, storage, realtimeClient };
}
