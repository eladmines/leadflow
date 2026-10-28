import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createQuoteRequestSchema,
  decideQuoteRequestSchema,
  publicDecisionRequestSchema,
  publicQuoteResponseSchema,
  quoteListQuerySchema,
  quoteListResponseSchema,
  quoteResponseSchema,
  sendQuoteRequestSchema,
  upsertQuoteRequestSchema,
} from '@leadflow/shared';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { QuoteService } from './service';

const params = z.object({ businessId: z.string() });
const idParams = z.object({ businessId: z.string(), id: z.string() });

/** Quotes (F18); registered inside the tenant scope. */
export const quoteTenantRoutes: FastifyPluginAsyncZod = async (app) => {
  const quotes = new QuoteService(app.prisma, app.config, app.email, app.log);
  const view = { preValidation: requirePermission('quotes.view') };
  const one = { 200: quoteResponseSchema };

  app.get(
    '/quotes',
    {
      ...view,
      schema: {
        params,
        querystring: quoteListQuerySchema,
        response: { 200: quoteListResponseSchema },
      },
    },
    async (req) => ({ quotes: await quotes.list(tenantOf(req), req.query) }),
  );
  app.post(
    '/quotes',
    {
      ...view,
      schema: { params, body: createQuoteRequestSchema, response: { 201: quoteResponseSchema } },
    },
    async (req, reply) =>
      reply.status(201).send({ quote: await quotes.create(tenantOf(req), req.body) }),
  );
  app.get('/quotes/:id', { ...view, schema: { params: idParams, response: one } }, async (req) => ({
    quote: await quotes.get(tenantOf(req), req.params.id),
  }));
  app.put(
    '/quotes/:id',
    { ...view, schema: { params: idParams, body: upsertQuoteRequestSchema, response: one } },
    async (req) => ({ quote: await quotes.update(tenantOf(req), req.params.id, req.body) }),
  );
  app.delete('/quotes/:id', { ...view, schema: { params: idParams } }, async (req, reply) => {
    await quotes.remove(tenantOf(req), req.params.id);
    return reply.status(204).send();
  });
  app.post(
    '/quotes/:id/send',
    { ...view, schema: { params: idParams, body: sendQuoteRequestSchema, response: one } },
    async (req) => ({ quote: await quotes.send(tenantOf(req), req.params.id, req.body) }),
  );
  app.post(
    '/quotes/:id/duplicate',
    { ...view, schema: { params: idParams, response: { 201: quoteResponseSchema } } },
    async (req, reply) =>
      reply.status(201).send({ quote: await quotes.duplicate(tenantOf(req), req.params.id) }),
  );
  app.post(
    '/quotes/:id/status',
    { ...view, schema: { params: idParams, body: decideQuoteRequestSchema, response: one } },
    async (req) => ({
      quote: await quotes.decide(tenantOf(req), req.params.id, req.body.status),
    }),
  );
};

/** The customer's quote page (no login: the unguessable link is the permission). */
export const quotePublicRoutes: FastifyPluginAsyncZod = async (app) => {
  const quotes = new QuoteService(app.prisma, app.config, app.email, app.log);
  const tokenParams = z.object({ token: z.string() });
  const noStore = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };

  app.get(
    '/api/v1/public/quotes/:token',
    { schema: { params: tokenParams, response: { 200: publicQuoteResponseSchema } } },
    async (req, reply) =>
      reply.headers(noStore).send({ quote: await quotes.publicGet(req.params.token) }),
  );
  app.post(
    '/api/v1/public/quotes/:token/decision',
    {
      config: { rateLimit: { max: 20, timeWindow: 600_000 } },
      schema: {
        params: tokenParams,
        body: publicDecisionRequestSchema,
        response: { 200: publicQuoteResponseSchema },
      },
    },
    async (req, reply) =>
      reply
        .headers(noStore)
        .send({ quote: await quotes.publicDecide(req.params.token, req.body.decision) }),
  );
};
