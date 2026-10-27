import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestApp, testConfig } from '../../../test/helpers';
import { createPrisma } from '../../lib/db';

describe('health', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('GET /health returns ok with a request id header', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /health/db returns ok when the database is reachable', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health/db' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/db returns 503 when the database is unreachable', async () => {
    const badUrl = 'postgresql://nobody:wrong@127.0.0.1:1/none?connect_timeout=1';
    const prisma: PrismaClient = createPrisma(badUrl);
    const broken = await createTestApp({ config: testConfig({ DATABASE_URL: badUrl }), prisma });
    try {
      const res = await broken.app.inject({ method: 'GET', url: '/health/db' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: 'unavailable' });
    } finally {
      await broken.close();
    }
  });

  it('unknown routes return the shared error shape in Hebrew', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toMatch(/[֐-׿]/);
  });
});
