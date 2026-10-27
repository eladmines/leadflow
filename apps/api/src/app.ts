import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { CSRF_HEADER_NAME } from '@leadflow/shared';
import type { AppConfig } from './config/env';
import { loggerOptions, type LogStream } from './lib/logger';
import { AppError } from './lib/errors';
import { registerErrorHandler } from './plugins/error-handler';
import { registerCsrfGuard } from './plugins/csrf';
import { registerSessionPlugin } from './plugins/session';
import { registerTenantSupport } from './plugins/tenant';
import { createEmailSender, SmtpEmailSender, type EmailSender } from './integrations/email';
import { healthRoutes } from './modules/health/routes';
import { authRoutes } from './modules/auth/routes';
import { businessRoutes } from './modules/businesses/routes';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    prisma: PrismaClient;
  }
}

export interface AppDeps {
  config: AppConfig;
  prisma: PrismaClient;
  /** Defaults to the adapter chosen by `EMAIL_TRANSPORT`. Tests inject a MemoryEmailSender. */
  emailSender?: EmailSender;
  /** Captures log lines (tests). */
  logStream?: LogStream;
}

/** Builds the Fastify app. Used by the server and by tests (via `app.inject`). */
export async function buildApp({ config, prisma, emailSender, logStream }: AppDeps) {
  const app = Fastify({
    logger: loggerOptions(config, logStream),
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

  // Treat an empty JSON body as "no body" instead of a 400, so body-less POSTs (logout,
  // resend-verification) work even when a client sends `Content-Type: application/json`.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '') return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  app.decorate('config', config);
  app.decorate('prisma', prisma);

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  registerErrorHandler(app);

  await app.register(cors, {
    origin: config.WEB_ORIGINS,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', CSRF_HEADER_NAME],
  });
  await app.register(cookie);
  // Not global: only routes with `config.rateLimit` are limited (per IP, per route).
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new AppError('RATE_LIMITED'),
  });

  registerCsrfGuard(app);
  registerSessionPlugin(app);
  registerTenantSupport(app);

  const email = emailSender ?? createEmailSender(config);
  if (email instanceof SmtpEmailSender) app.addHook('onClose', async () => email.close());

  await app.register(healthRoutes);
  await app.register(authRoutes, { email });
  await app.register(businessRoutes);

  return app;
}
