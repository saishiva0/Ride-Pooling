import { parseNodeEnv, type NodeEnv } from '@ridepool/config';
import { parseEnv, type Env } from './env.js';

/**
 * Centralized runtime configuration. Loaded once when the server boots.
 * Environment variables are validated at startup so a misconfigured process
 * fails fast with a clear message.
 */
export interface AppConfig extends Env {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const env = parseEnv(source);
  const nodeEnv = parseNodeEnv(env.NODE_ENV);

  return {
    ...env,
    nodeEnv,
    isProduction: nodeEnv === 'production',
    isDevelopment: nodeEnv === 'development',
    isTest: nodeEnv === 'test',
  };
}
