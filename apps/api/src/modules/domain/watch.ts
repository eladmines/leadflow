import type { FastifyInstance } from 'fastify';
import { DomainExpiryService } from './service';

/**
 * Looks the businesses' domains up at their registries and sends the 60/30/7-day reminders (F33).
 * In-process like the other background jobs: first a minute after start, then every few hours; a
 * domain is only asked about once a day. Returns a stop function.
 */
export function startDomainWatch(app: FastifyInstance, intervalMs = 6 * 3_600_000) {
  const service = new DomainExpiryService(
    app.prisma,
    app.domainExpiry,
    app.email,
    app.config,
    app.log,
  );
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await service.checkDue();
    } catch (err) {
      app.log.error({ errName: (err as Error)?.name }, 'domain watch run failed');
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void tick(), 60_000);
  const timer = setInterval(() => void tick(), intervalMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
