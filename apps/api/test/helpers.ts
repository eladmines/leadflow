import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { loadConfig, type AppConfig } from '../src/config/env';
import { createPrisma } from '../src/lib/db';

export function testConfig(overrides: Partial<Record<string, string>> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL!,
    WEB_ORIGINS: 'http://localhost:5173',
    ...overrides,
  });
}

/** Builds an app wired to the test database. Call `close()` in afterAll. */
export async function createTestApp(opts: { config?: AppConfig; prisma?: PrismaClient } = {}) {
  const config = opts.config ?? testConfig();
  const prisma = opts.prisma ?? createPrisma(config.DATABASE_URL);
  const app = await buildApp({ config, prisma });
  await app.ready();
  return {
    app,
    prisma,
    close: async () => {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

/**
 * Empties every application table between tests. Keeps Prisma's migration table.
 * Tables are discovered dynamically so new features need no changes here.
 */
export async function resetDb(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
