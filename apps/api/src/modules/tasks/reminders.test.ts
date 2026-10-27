import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers';
import { startTaskReminders } from './reminders';

describe('task reminder job', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  // Regression: the job used to add a Fastify hook, which throws once the server is ready/listening
  // (it crashed the real server on start).
  it('can start after the app is ready and stops cleanly', () => {
    const stop = startTaskReminders(ctx.app, 10_000);
    expect(typeof stop).toBe('function');
    stop();
  });
});
