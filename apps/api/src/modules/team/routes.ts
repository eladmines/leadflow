import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  acceptInviteResponseSchema,
  invitationListResponseSchema,
  invitationResponseSchema,
  invitePreviewResponseSchema,
  inviteRequestSchema,
  inviteTokenRequestSchema,
  teamApiPaths,
  updateMemberRequestSchema,
} from '@leadflow/shared';
import { authOf, requireAuth } from '../../plugins/session';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { TeamService } from './service';

const params = z.object({ businessId: z.string() });
const inviteParams = z.object({ businessId: z.string(), inviteId: z.string() });
const memberParams = z.object({ businessId: z.string(), userId: z.string() });

const service = (app: Parameters<FastifyPluginAsyncZod>[0]) =>
  new TeamService(app.prisma, app.config, app.email, app.log);

/** Owner-side team management; registered inside the tenant scope. */
export const teamTenantRoutes: FastifyPluginAsyncZod = async (app) => {
  const team = service(app);
  const manage = { preValidation: requirePermission('members.manage') };

  app.get(
    '/invitations',
    { ...manage, schema: { params, response: { 200: invitationListResponseSchema } } },
    async (req) => ({ invitations: await team.listInvitations(tenantOf(req)) }),
  );

  app.post(
    '/invitations',
    {
      ...manage,
      schema: { params, body: inviteRequestSchema, response: { 201: invitationResponseSchema } },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send({ invitation: await team.invite(tenantOf(req), req.body.email, req.body.role) }),
  );

  app.post(
    '/invitations/:inviteId/resend',
    { ...manage, schema: { params: inviteParams, response: { 200: invitationResponseSchema } } },
    async (req) => ({ invitation: await team.resend(tenantOf(req), req.params.inviteId) }),
  );

  app.delete(
    '/invitations/:inviteId',
    { ...manage, schema: { params: inviteParams } },
    async (req, reply) => {
      await team.revoke(tenantOf(req), req.params.inviteId);
      return reply.status(204).send();
    },
  );

  app.patch(
    '/members/:userId',
    { ...manage, schema: { params: memberParams, body: updateMemberRequestSchema } },
    async (req, reply) => {
      await team.changeRole(tenantOf(req), req.params.userId, req.body.role);
      return reply.status(204).send();
    },
  );

  app.delete(
    '/members/:userId',
    { ...manage, schema: { params: memberParams } },
    async (req, reply) => {
      await team.remove(tenantOf(req), req.params.userId);
      return reply.status(204).send();
    },
  );
};

/** Invitee side: preview (no sign-in needed) and accept (signed in as the invited email). */
export const teamRoutes: FastifyPluginAsyncZod = async (app) => {
  const team = service(app);
  const rateLimit = {
    rateLimit: {
      max: app.config.AUTH_RATE_LIMIT_MAX,
      timeWindow: app.config.AUTH_RATE_LIMIT_WINDOW,
    },
  };

  app.post(
    teamApiPaths.preview,
    {
      config: rateLimit,
      schema: { body: inviteTokenRequestSchema, response: { 200: invitePreviewResponseSchema } },
    },
    async (req) => ({ invite: await team.preview(req.body.token) }),
  );

  app.post(
    teamApiPaths.accept,
    {
      config: rateLimit,
      preValidation: requireAuth,
      schema: { body: inviteTokenRequestSchema, response: { 200: acceptInviteResponseSchema } },
    },
    async (req) => team.accept(req.body.token, authOf(req).user),
  );
};
