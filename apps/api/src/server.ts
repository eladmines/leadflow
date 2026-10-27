import { buildApp } from './app';
import { loadConfig } from './config/env';
import { createPrisma } from './lib/db';

const config = loadConfig();
const prisma = createPrisma(config.DATABASE_URL);
const app = await buildApp({ config, prisma });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: '0.0.0.0' });
