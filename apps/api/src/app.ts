import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { PrismaClient } from '@prisma/client';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppConfig } from './config/env';
import { loggerOptions } from './lib/logger';
import { registerErrorHandler } from './plugins/error-handler';
import { healthRoutes } from './modules/health/routes';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    prisma: PrismaClient;
  }
}

export interface AppDeps {
  config: AppConfig;
  prisma: PrismaClient;
}

/** Builds the Fastify app. Used by the server and by tests (via `app.inject`). */
export async function buildApp({ config, prisma }: AppDeps) {
  const app = Fastify({
    logger: loggerOptions(config),
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming)
        ? incoming
        : randomUUID();
    },
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('config', config);
  app.decorate('prisma', prisma);

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  registerErrorHandler(app);
  await app.register(healthRoutes);

  return app;
}
