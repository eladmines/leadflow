import type { FastifyPluginAsync } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { domainExpiryResponseSchema } from '@simplecatch/shared';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { DomainExpiryService } from './service';

const service = (app: Parameters<FastifyPluginAsync>[0]) =>
  new DomainExpiryService(app.prisma, app.domainExpiry, app.email, app.config, app.log);

/** F33: everyone in the business sees when the domain expires; the owner can look it up now. */
export const domainTenantRoutes: FastifyPluginAsyncZod = async (app) => {
  const domain = service(app);

  app.get(
    '/domain',
    {
      preValidation: requirePermission('business.view'),
      schema: { response: { 200: domainExpiryResponseSchema } },
    },
    async (req) => domain.statusAndRefresh(tenantOf(req)),
  );

  app.post(
    '/domain',
    {
      preValidation: requirePermission('business.update'),
      schema: { response: { 200: domainExpiryResponseSchema } },
    },
    async (req) => domain.checkNow(tenantOf(req)),
  );
};
