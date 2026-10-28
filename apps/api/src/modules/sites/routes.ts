import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createSiteRequestSchema,
  publishRequestSchema,
  saveDraftRequestSchema,
  setSubdomainRequestSchema,
  siteResponseSchema,
  siteVersionListResponseSchema,
} from '@leadflow/shared';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { MediaService } from '../media/service';
import { SiteService } from './service';

const params = z.object({ businessId: z.string() });
const versionParams = z.object({ businessId: z.string(), versionId: z.string() });

/** F04/F06 site routes; registered inside the tenant scope. */
export const siteTenantRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new SiteService(
    app.prisma,
    app.config,
    app.log,
    app.siteCache,
    new MediaService(app.prisma, app.storage, app.config),
  );
  const ok = { 200: siteResponseSchema };

  app.get(
    '/site',
    { preValidation: requirePermission('site.view'), schema: { params, response: ok } },
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
      schema: { params, body: saveDraftRequestSchema, response: ok },
    },
    async (req) => ({ site: await service.saveDraft(tenantOf(req), req.body) }),
  );

  app.put(
    '/site/subdomain',
    {
      preValidation: requirePermission('site.publish'),
      schema: { params, body: setSubdomainRequestSchema, response: ok },
    },
    async (req) => ({ site: await service.setSubdomain(tenantOf(req), req.body.subdomain) }),
  );

  app.post(
    '/site/publish',
    {
      preValidation: requirePermission('site.publish'),
      schema: { params, body: publishRequestSchema, response: ok },
    },
    async (req) => ({ site: await service.publish(tenantOf(req), req.body.revision) }),
  );

  app.post(
    '/site/unpublish',
    { preValidation: requirePermission('site.publish'), schema: { params, response: ok } },
    async (req) => ({ site: await service.unpublish(tenantOf(req)) }),
  );

  app.get(
    '/site/versions',
    {
      preValidation: requirePermission('site.view'),
      schema: { params, response: { 200: siteVersionListResponseSchema } },
    },
    async (req) => ({ versions: await service.listVersions(tenantOf(req)) }),
  );

  app.post(
    '/site/versions/:versionId/rollback',
    {
      preValidation: requirePermission('site.publish'),
      schema: { params: versionParams, response: ok },
    },
    async (req) => ({ site: await service.rollback(tenantOf(req), req.params.versionId) }),
  );
};
