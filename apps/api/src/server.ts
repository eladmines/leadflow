import { createServer } from 'node:http';
import { buildApp } from './app';
import { startTaskReminders } from './modules/tasks/reminders';
import { startBookingNudges } from './modules/whatsapp/nudges';
import { createEmailSender } from './integrations/email';
import { loadConfig } from './config/env';
import { createPrisma } from './lib/db';
import { buildPublicApp } from './public/app';
import { PublishedSiteCache } from './public/cache';
import { DatabaseStorage, LocalDiskStorage } from './integrations/storage';

const config = loadConfig();
const prisma = createPrisma(config.DATABASE_URL);
// One cache shared by both apps, so a publish is visible immediately.
const siteCache = new PublishedSiteCache();
const emailSender = createEmailSender(config);
// Hosts whose disk is wiped on restart keep images in Postgres (D-119).
const storage =
  config.STORAGE_DRIVER === 'database'
    ? new DatabaseStorage(prisma)
    : new LocalDiskStorage(config.MEDIA_DIR);
// Without a domain, one port serves everything and the sites live under /s/ (D-119).
const singlePort = config.PUBLIC_SITE_MODE === 'path';
const server = singlePort
  ? createServer((req, res) => {
      const target = req.url?.startsWith('/s/') ? publicApp : app;
      target.routing(req, res);
    })
  : undefined;

const app = await buildApp({
  config,
  prisma,
  siteCache,
  emailSender,
  storage,
  ...(server ? { serverFactory: () => server } : {}),
});
// Customer sites by Host header (F06). Same process in the MVP; a Cloudflare Worker later.
const publicApp = await buildPublicApp({
  config,
  prisma,
  cache: siteCache,
  email: emailSender,
  storage,
});

let stopReminders = () => {};
let stopNudges = () => {};
const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  stopReminders();
  stopNudges();
  await Promise.all([app.close(), publicApp.close()]);
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Background jobs run with the server (never in tests, which call the services directly).
stopReminders = startTaskReminders(app);
stopNudges = startBookingNudges(app);
if (singlePort) {
  await publicApp.ready();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
} else {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  await publicApp.listen({ port: config.PUBLIC_PORT, host: '0.0.0.0' });
}
