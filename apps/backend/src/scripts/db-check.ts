/**
 * Explicit database connectivity check.
 *
 * Usage: pnpm db:check
 * Exits 0 when PostgreSQL is reachable, non-zero otherwise.
 */
import 'dotenv/config';
import { loadConfig } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

async function main(): Promise<void> {
  const logger = createLogger({ pretty: false });
  loadConfig();

  logger.info('Checking database connectivity...');
  const result = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT now()`;
  logger.info({ result: result[0] }, 'Database connection OK');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Database connectivity check FAILED:', err.message ?? err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
