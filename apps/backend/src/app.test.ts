import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { loadConfig } from './config/index.js';
import { createLogger } from './lib/logger.js';

const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/ridepool',
};

function makeApp() {
  const config = loadConfig(testEnv);
  const logger = createLogger({ level: 'silent', pretty: false });
  return createApp({ config, logger });
}

describe('health endpoint', () => {
  it('returns 200 with machine-readable status', async () => {
    const app = makeApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('ridepool-api');
    expect(typeof res.body.timestamp).toBe('string');
  });
});

describe('unknown routes', () => {
  // Phase 3.10: the not-found handler was corrected from a placeholder 500 to
  // a proper 404 (NotFoundError) when the /api/v1 boundary landed — unknown
  // routes are a client error (see middleware/error-handler.ts).
  it('returns a structured 404 for unmatched paths', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
