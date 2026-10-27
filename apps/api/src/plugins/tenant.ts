import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { can, type Permission, type Role } from '@leadflow/shared';
import { AppError } from '../lib/errors';
import { authOf } from './session';

/** Who is acting, in which business, with which role. Every tenant service takes this. */
export interface TenantContext {
  businessId: string;
  userId: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set only inside the tenant scope, after membership is verified. */
    tenant: TenantContext | null;
  }
  interface FastifyInstance {
    /** URLs of every route registered inside the tenant scope (used by the isolation tests). */
    tenantRouteUrls: Set<string>;
    /** Every registered route (method + URL), for the isolation tests' route walker. */
    routeTable: { method: string; url: string }[];
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Root-level setup. Call once in buildApp, before any route is registered. */
export function registerTenantSupport(app: FastifyInstance) {
  app.decorateRequest('tenant', null);
  app.decorate('tenantRouteUrls', new Set<string>());
  app.decorate('routeTable', []);
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) app.routeTable.push({ method, url: route.url });
  });
}

/**
 * Wraps tenant routes. Register it with `prefix: businessApiPaths.tenantPrefix`.
 *
 * In `preValidation` (before body validation, so an outsider learns nothing from a 400):
 * 1. anonymous → 401;
 * 2. `:businessId` must be a UUID with an ACTIVE membership for the signed-in user → else 404
 *    (not 403, so the existence of other businesses is never revealed).
 *
 * The business id comes only from the URL and only after this check. Never read it from the
 * body, query or headers.
 */
export function tenantScope(routes: FastifyPluginAsync): FastifyPluginAsync {
  return async (scope) => {
    scope.addHook('onRoute', (route) => {
      scope.tenantRouteUrls.add(route.url);
    });

    scope.addHook('preValidation', async (req) => {
      const auth = authOf(req);
      const { businessId } = req.params as { businessId?: string };
      if (!businessId || !UUID_PATTERN.test(businessId)) throw new AppError('NOT_FOUND');

      const membership = await scope.prisma.membership.findFirst({
        where: { businessId, userId: auth.user.id, status: 'ACTIVE' },
        select: { role: true },
      });
      if (!membership) throw new AppError('NOT_FOUND');

      req.tenant = { businessId, userId: auth.user.id, role: membership.role };
    });

    await scope.register(routes);
  };
}

export function tenantOf(req: FastifyRequest): TenantContext {
  if (!req.tenant) throw new Error('tenantOf() called outside the tenant scope');
  return req.tenant;
}

/** Route-level guard (use as `preValidation`): 403 when the caller's role lacks the permission. */
export function requirePermission(permission: Permission) {
  return async (req: FastifyRequest) => {
    if (!can(tenantOf(req).role, permission)) throw new AppError('FORBIDDEN');
  };
}
