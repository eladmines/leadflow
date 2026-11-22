import type { FastifyInstance } from 'fastify';
import { WhatsAppService } from './service';

/**
 * Every couple of minutes: the new inbox mail of every connected Gmail becomes a conversation
 * (F29, D-188). In-process like the booking nudges; returns a stop function. Does nothing until a
 * business connects Gmail.
 */
export function startGmailSync(app: FastifyInstance, intervalMs = 120_000) {
  const service = new WhatsAppService(
    app.prisma,
    app.config,
    app.whatsappSender,
    app.log,
    app.storage,
    app.messengerSender,
    app.email,
    app.gmailApi,
  );
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await service.syncGmail();
    } catch (err) {
      app.log.error({ errName: (err as Error)?.name }, 'gmail sync run failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
