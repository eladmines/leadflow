import { buildApp } from './app';
import { createEmailSender } from './integrations/email';
import { loadConfig } from './config/env';
import { createPrisma } from './lib/db';
import { buildPublicApp } from './public/app';
import { PublishedSiteCache } from './public/cache';

const config = loadConfig();
const prisma = createPrisma(config.DATABASE_URL);
// One cache shared by both apps, so a publish is visible immediately.
const siteCache = new PublishedSiteCache();
const emailSender = createEmailSender(config);
const app = await buildApp({ config, prisma, siteCache, emailSender });
// Customer sites by Host header (F06). Same process in the MVP; a Cloudflare Worker later.
const publicApp = await buildPublicApp({ config, prisma, cache: siteCache, email: emailSender });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await Promise.all([app.close(), publicApp.close()]);
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: '0.0.0.0' });
await publicApp.listen({ port: config.PUBLIC_PORT, host: '0.0.0.0' });
