import express from 'express';
import cors from 'cors';
import { API_BASE_PATH } from '@ridepool/shared';
import type { AppConfig } from './config/index.js';
import type { Logger } from './lib/logger.js';
import {
  createErrorHandler,
  notFoundHandler,
} from './middleware/error-handler.js';
import { requestContext } from './middleware/request-context.js';
import { healthRouter } from './modules/health/health.router.js';
import {
  createAuthMiddleware,
  type HttpAuthenticator,
} from './modules/auth/http/auth.middleware.js';
import { createBearerTokenAuthenticator } from './modules/auth/http/bearer-authenticator.js';
import { createAuthRouter } from './modules/auth/http/auth.routes.js';
import {
  createDefaultAuthDependencies,
  type AuthDependencies,
} from './modules/auth/application/auth-dependencies.js';
import { createRideRouter } from './modules/ride/http/ride.routes.js';
import {
  matchingConfigurationFromConfig,
  matchingMaxResultsFromConfig,
} from './modules/ride/application/matching-config.js';
import { createNotificationRouter } from './modules/notification/http/notification.routes.js';
import { createDeviceTokenRouter } from './modules/notification/http/device-token.routes.js';
import { createSafetyRouter } from './modules/safety/http/safety.routes.js';
import { createChatRouter } from './modules/communication/http/chat.routes.js';
import type { Express } from 'express';

export interface AppOptions {
  config: AppConfig;
  logger: Logger;
  authenticator?: HttpAuthenticator;
  authDeps?: Partial<AuthDependencies>;
}

export function createApp(options: AppOptions): Express {
  const { config, logger } = options;
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  const corsOrigin = config.CORS_ORIGIN;
  if (corsOrigin) {
    app.use(cors({ origin: corsOrigin }));
  }

  app.use(requestContext(logger));
  app.use(healthRouter());

  const authDeps = {
    ...createDefaultAuthDependencies(config),
    ...options.authDeps,
  };
  const requireAuth = createAuthMiddleware(
    options.authenticator ??
      createBearerTokenAuthenticator(authDeps.sessionService),
  );
  app.use(
    API_BASE_PATH,
    createRideRouter({
      requireAuth,
      matchingConfig: matchingConfigurationFromConfig(config),
      matchingMaxResults: matchingMaxResultsFromConfig(config),
    }),
  );
  app.use(API_BASE_PATH, createNotificationRouter({ requireAuth }));
  app.use(API_BASE_PATH, createDeviceTokenRouter({ requireAuth }));
  app.use(API_BASE_PATH, createSafetyRouter({ requireAuth }));
  app.use(API_BASE_PATH, createChatRouter({ requireAuth }));
  app.use(API_BASE_PATH, createAuthRouter({ requireAuth, deps: authDeps }));

  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger, exposeStack: config.isDevelopment }));

  return app;
}
