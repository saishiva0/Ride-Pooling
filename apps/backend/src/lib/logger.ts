import pino from 'pino';

/**
 * Structured backend logger.
 *
 * - Development: human-readable output via pino-pretty.
 * - Production/test: JSON structured logs.
 *
 * Logging rules from Phase 0 (`docs/architecture/event-model.md` §4):
 * never log passwords, tokens, secrets, unnecessary precise location data, or
 * sensitive personal information.
 */
const DEV_LEVEL = 'debug';

export function createLogger(options?: { level?: string; pretty?: boolean }) {
  const pretty = options?.pretty ?? process.env.NODE_ENV !== 'production';

  return pino({
    level: options?.level ?? (pretty ? DEV_LEVEL : 'info'),
    base: {
      service: 'ridepool-api',
    },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;

export const logger = createLogger();
