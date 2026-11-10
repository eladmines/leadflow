import { randomUUID } from 'node:crypto';
import path from 'node:path';
import Fastify, { type FastifyServerFactory } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import type { PrismaClient } from '@prisma/client';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { apiPaths, CSRF_HEADER_NAME } from '@leadflow/shared';
import type { AppConfig } from './config/env';
import { loggerOptions, type LogStream } from './lib/logger';
import { AppError } from './lib/errors';
import { registerErrorHandler } from './plugins/error-handler';
import { createWebAppHandler } from './lib/web-app';
import { registerCsrfGuard } from './plugins/csrf';
import { registerSessionPlugin } from './plugins/session';
import { registerTenantSupport, tenantScope } from './plugins/tenant';
import { createEmailSender, SmtpEmailSender, type EmailSender } from './integrations/email';
import { healthRoutes } from './modules/health/routes';
import { authRoutes } from './modules/auth/routes';
import { businessRoutes, businessTenantRoutes } from './modules/businesses/routes';
import { siteTenantRoutes } from './modules/sites/routes';
import { leadTenantRoutes } from './modules/leads/routes';
import { teamRoutes, teamTenantRoutes } from './modules/team/routes';
import { PublishedSiteCache } from './public/cache';
import { LocalDiskStorage, type StorageProvider } from './integrations/storage';
import { mediaTenantRoutes } from './modules/media/routes';
import { taskTenantRoutes } from './modules/tasks/routes';
import { appointmentTenantRoutes } from './modules/appointments/routes';
import { quotePublicRoutes, quoteTenantRoutes } from './modules/quotes/routes';
import { reportTenantRoutes } from './modules/reports/routes';
import { registerMediaServing } from './modules/media/serve';
import { createWhatsAppSender, type WhatsAppSender } from './integrations/whatsapp';
import { createMessengerSender, type MessengerSender } from './integrations/messenger';
import { conversationTenantRoutes } from './modules/conversations/routes';
import { channelPublicRoutes, channelTenantRoutes } from './modules/channels/routes';
import { createMetaApi, type MetaApi } from './integrations/meta';
import {
  emailWebhookRoutes,
  messengerWebhookRoutes,
  whatsappTenantRoutes,
  whatsappWebhookRoutes,
} from './modules/whatsapp/routes';
import { notificationTenantRoutes } from './modules/notifications/routes';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    prisma: PrismaClient;
    /** Published-page cache shared with the public-site server (invalidated on publish). */
    siteCache: PublishedSiteCache;
    /** Outbound email (auth links, invitations). */
    email: EmailSender;
    /** Uploaded media (F05). */
    storage: StorageProvider;
    /** Outbound WhatsApp (F12), also used by the booking bot's background job. */
    whatsappSender: WhatsAppSender;
    /** Outbound Facebook Messenger (F23). */
    messengerSender: MessengerSender;
    /** Meta's Graph API for connecting channels (F25). */
    metaApi: MetaApi;
  }
}

export interface AppDeps {
  config: AppConfig;
  prisma: PrismaClient;
  /** Defaults to the adapter chosen by `EMAIL_TRANSPORT`. Tests inject a MemoryEmailSender. */
  emailSender?: EmailSender;
  /** Pass the same instance to buildPublicApp so publishing shows immediately. */
  siteCache?: PublishedSiteCache;
  /** Defaults to local disk at MEDIA_DIR. */
  storage?: StorageProvider;
  /** Captures log lines (tests). */
  logStream?: LogStream;
  /** Defaults to the adapter chosen by `WHATSAPP_PROVIDER`. Tests inject a MemoryWhatsAppSender. */
  whatsappSender?: WhatsAppSender;
  /** Defaults to the adapter chosen by `MESSENGER_PROVIDER`. Tests inject a MemoryMessengerSender. */
  messengerSender?: MessengerSender;
  /** Defaults to Meta's Graph API with a cloud provider, else a stand-in. Tests inject one. */
  metaApi?: MetaApi;
  /** A server shared with the public-site app (one port, D-119); it calls `app.routing`. */
  serverFactory?: FastifyServerFactory;
}

/** Builds the Fastify app. Used by the server and by tests (via `app.inject`). */
export async function buildApp({
  config,
  prisma,
  emailSender,
  logStream,
  siteCache,
  storage,
  whatsappSender,
  messengerSender,
  metaApi,
  serverFactory,
}: AppDeps) {
  const app = Fastify({
    ...(serverFactory ? { serverFactory } : {}),
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
  app.decorate('siteCache', siteCache ?? new PublishedSiteCache());
  app.decorate('storage', storage ?? new LocalDiskStorage(config.MEDIA_DIR));

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  registerErrorHandler(
    app,
    config.WEB_DIST_DIR ? createWebAppHandler(path.resolve(config.WEB_DIST_DIR)) : undefined,
  );

  await app.register(cors, {
    origin: config.WEB_ORIGINS,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', CSRF_HEADER_NAME, 'X-LeadFlow-Locale'],
  });
  await app.register(cookie);
  // Uploads: one file per request; the route enforces the size limit too.
  await app.register(multipart, { limits: { files: 1, fields: 5, fileSize: 8 * 1024 * 1024 } });
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
  app.decorate('email', email);

  await app.register(healthRoutes);
  registerMediaServing(app, app.storage, path.resolve(config.SITE_STOCK_DIR));
  await app.register(authRoutes, { email });
  await app.register(businessRoutes);
  await app.register(teamRoutes);
  await app.register(quotePublicRoutes);
  const whatsapp = whatsappSender ?? createWhatsAppSender(config);
  app.decorate('whatsappSender', whatsapp);
  const messenger = messengerSender ?? createMessengerSender(config);
  app.decorate('messengerSender', messenger);
  await app.register(whatsappWebhookRoutes(whatsapp));
  await app.register(messengerWebhookRoutes(whatsapp, messenger));
  await app.register(emailWebhookRoutes);
  app.decorate('metaApi', metaApi ?? createMetaApi(config));
  await app.register(channelPublicRoutes);
  // Every tenant-scoped feature registers here, behind the membership check (404 for outsiders).
  await app.register(
    tenantScope(async (scope) => {
      await scope.register(businessTenantRoutes);
      await scope.register(siteTenantRoutes);
      await scope.register(leadTenantRoutes);
      await scope.register(teamTenantRoutes);
      await scope.register(mediaTenantRoutes);
      await scope.register(taskTenantRoutes);
      await scope.register(appointmentTenantRoutes);
      await scope.register(quoteTenantRoutes);
      await scope.register(reportTenantRoutes);
      await scope.register(whatsappTenantRoutes(whatsapp));
      await scope.register(notificationTenantRoutes);
      await scope.register(conversationTenantRoutes);
      await scope.register(channelTenantRoutes);
    }),
    { prefix: apiPaths.businesses.tenantPrefix },
  );

  return app;
}
