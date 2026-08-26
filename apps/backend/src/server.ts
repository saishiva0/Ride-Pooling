import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from './config/index.js';
import { createApp } from './app.js';
import { createLogger, type Logger } from './lib/logger.js';
import { createBearerTokenAuthenticator } from './modules/auth/http/bearer-authenticator.js';
import { createDefaultAuthDependencies } from './modules/auth/application/auth-dependencies.js';
import { attachSocketServer } from './modules/realtime/infrastructure/socket-server.js';
import {
  setPushNotificationDispatcher,
  createPushNotificationDispatcher,
} from './modules/realtime/application/push-publisher.js';
import { defaultExpoPushProvider } from './modules/notification/infrastructure/expo-push-provider.js';
import {
  findActiveDeviceTokensForUser,
  deactivateDeviceToken,
} from './modules/notification/infrastructure/device-push-token.repository.js';

export interface StartResult {
  server: Server;
  port: number;
  shutdown: () => Promise<void>;
}

/**
 * Boots the HTTP server with graceful shutdown and structured startup logs.
 * Returns a shutdown function so the same path is exercised in tests.
 */
export async function startServer(options?: {
  logger?: Logger;
  env?: NodeJS.ProcessEnv;
  port?: number;
}): Promise<StartResult> {
  const logger = options?.logger ?? createLogger();
  let config;
  try {
    config = loadConfig(options?.env);
  } catch (err) {
    logger.fatal({ err }, 'Configuration error');
    throw err;
  }

  const app = createApp({ config, logger });
  const port = options?.port ?? config.PORT;
  const server = createServer(app);

  // Phase 3.11: realtime layer (gated by the reserved SOCKET_ENABLED env var).
  // Phase 3.18 (OD-005 resolved): sockets authenticate with the real bearer
  // token authenticator (the same session store the HTTP boundary uses).
  if (config.SOCKET_ENABLED) {
    const authDeps = createDefaultAuthDependencies(config);
    attachSocketServer(server, {
      logger,
      authenticator: createBearerTokenAuthenticator(authDeps.sessionService),
    });
  }

  // Phase 3.23: push notification layer (gated by PUSH_ENABLED env var).
  // Uses Expo Push Service via the provider abstraction.
  if (config.PUSH_ENABLED) {
    const pushDispatcher = createPushNotificationDispatcher({
      provider: defaultExpoPushProvider,
      getActiveTokens: async (userId: string) => {
        const { prisma } = await import('./lib/prisma.js');
        return prisma.$transaction(async (tx) => {
          return findActiveDeviceTokensForUser(tx, userId);
        });
      },
      deactivateToken: async (token: string) => {
        const { prisma } = await import('./lib/prisma.js');
        return prisma.$transaction(async (tx) => {
          await deactivateDeviceToken(tx, token);
        });
      },
    });
    setPushNotificationDispatcher(pushDispatcher);
    logger.info('Push notification dispatcher activated');
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', (err) => {
      reject(err);
    });
    server.listen(port, () => {
      resolve();
    });
  });

  logger.info({ port, env: config.nodeEnv }, 'RidePool API started');

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info('Shutting down gracefully');
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    logger.info('Server closed');
  }

  process.on('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });

  return { server, port, shutdown };
}

// Only start when executed directly (not when imported by tests).
const toPosix = (p: string): string => p.replace(/\\/g, '/');
const isDirectRun =
  !!process.argv[1] &&
  toPosix(fileURLToPath(import.meta.url)) === toPosix(process.argv[1]);
if (isDirectRun) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
