import { PrismaClient } from '@prisma/client';

/**
 * Prisma client singleton. Connection is lazy; the server does not require a
 * database to boot so the health endpoint stays available. Use `db-check` to
 * explicitly validate connectivity.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
