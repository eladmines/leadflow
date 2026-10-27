import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createSiteRequestSchema,
  saveDraftRequestSchema,
  siteResponseSchema,
} from '@leadflow/shared';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { SiteService } from './service';

const params = z.object({ businessId: z.string() });

/** F04 site builder routes; registered inside the tenant scope. */
export const siteTenantRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new SiteService(app.prisma, app.log);

  app.get(
    '/site',
    {
      preValidation: requirePermission('site.view'),
      schema: { params, response: { 200: siteResponseSchema } },
    },
    async (req) => ({ site: await service.get(tenantOf(req)) }),
  );

  app.post(
    '/site',
    {
      preValidation: requirePermission('site.edit'),
      schema: { params, body: createSiteRequestSchema, response: { 201: siteResponseSchema } },
    },
    async (req, reply) => {
      const site = await service.create(tenantOf(req), req.body.templateKey);
      return reply.status(201).send({ site });
    },
  );

  app.put(
    '/site/draft',
    {
      preValidation: requirePermission('site.edit'),
      schema: { params, body: saveDraftRequestSchema, response: { 200: siteResponseSchema } },
    },
    async (req) => ({ site: await service.saveDraft(tenantOf(req), req.body) }),
  );
};
