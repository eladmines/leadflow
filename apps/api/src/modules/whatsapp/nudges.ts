import type { FastifyInstance } from 'fastify';
import { WhatsAppService } from './service';

/**
 * Every minute: booking conversations that stopped in the middle get the business's showcase
 * (D-106). In-process like the task reminders; returns a stop function.
 */
export function startBookingNudges(app: FastifyInstance, intervalMs = 60_000) {
  const service = new WhatsAppService(
    app.prisma,
    app.config,
    app.whatsappSender,
    app.log,
    app.storage,
    app.messengerSender,
  );
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await service.nudgeAbandonedBookings();
    } catch (err) {
      app.log.error({ errName: (err as Error)?.name }, 'booking nudge run failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
