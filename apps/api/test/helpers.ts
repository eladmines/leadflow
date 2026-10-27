import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE, SESSION_COOKIE_NAME } from '@leadflow/shared';
import { buildApp } from '../src/app';
import { loadConfig, type AppConfig } from '../src/config/env';
import { createPrisma } from '../src/lib/db';
import type { LogStream } from '../src/lib/logger';
import { MemoryEmailSender } from '../src/integrations/email';

export const TEST_WEB_ORIGIN = 'http://localhost:5173';

/**
 * Test configuration. Uses the in-memory email transport and a high auth rate limit (every
 * injected request comes from 127.0.0.1); rate-limit tests pass a low `AUTH_RATE_LIMIT_MAX`.
 */
export function testConfig(overrides: Partial<Record<string, string>> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL!,
    WEB_ORIGINS: TEST_WEB_ORIGIN,
    APP_URL: TEST_WEB_ORIGIN,
    EMAIL_TRANSPORT: 'memory',
    AUTH_RATE_LIMIT_MAX: '10000',
    // Uploaded images go to a throwaway folder, never the dev media folder.
    MEDIA_DIR: path.join(os.tmpdir(), `leadflow-test-media-${process.pid}`),
    ...overrides,
  });
}

/** Builds an app wired to the test database. Call `close()` in afterAll. */
export async function createTestApp(
  opts: {
    config?: AppConfig;
    prisma?: PrismaClient;
    email?: MemoryEmailSender;
    /** Captures log output; set `LOG_LEVEL` in the config to choose the level. */
    logStream?: LogStream;
  } = {},
) {
  const config = opts.config ?? testConfig();
  const prisma = opts.prisma ?? createPrisma(config.DATABASE_URL);
  const email = opts.email ?? new MemoryEmailSender();
  const app = await buildApp({ config, prisma, emailSender: email, logStream: opts.logStream });
  await app.ready();
  return {
    app,
    prisma,
    email,
    close: async () => {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

/** Headers every state-changing request from the web carries (CSRF marker). */
export const csrfHeaders = { [CSRF_HEADER_NAME.toLowerCase()]: CSRF_HEADER_VALUE };

/** `Cookie` header for a session token. */
export function sessionCookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
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
