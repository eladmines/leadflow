import type { FastifyInstance } from 'fastify';
import { TaskService } from './service';

/**
 * Checks for due task reminders every minute (in-process; safe with several instances).
 * Returns a stop function: no Fastify hooks are added, so it can be started at any time.
 */
export function startTaskReminders(app: FastifyInstance, intervalMs = 60_000) {
  const service = new TaskService(app.prisma);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await service.sendDueReminders(app.email, app.config, app.log);
    } catch (err) {
      app.log.error({ err }, 'task reminder run failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
