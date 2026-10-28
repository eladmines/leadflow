import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  apiPaths,
  changePasswordRequestSchema,
  loginRequestSchema,
  meResponseSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
  verifyEmailRequestSchema,
} from '@leadflow/shared';
import { authOf, requireAuth } from '../../plugins/session';
import type { EmailSender } from '../../integrations/email';
import { AuthService, requestMeta, toAuthUser } from './service';

export interface AuthRoutesOptions {
  email: EmailSender;
}

const paths = apiPaths.auth;

/** F01 auth endpoints. Paths, bodies and responses come from the shared contract. */
export const authRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = async (app, opts) => {
  const service = new AuthService({ prisma: app.prisma, email: opts.email, config: app.config });

  // Per client IP, per route (each route gets its own counter store), D-023.
  const rateLimit = {
    rateLimit: {
      max: app.config.AUTH_RATE_LIMIT_MAX,
      timeWindow: app.config.AUTH_RATE_LIMIT_WINDOW,
    },
  };

  app.post(
    paths.register,
    {
      config: rateLimit,
      schema: { body: registerRequestSchema, response: { 201: meResponseSchema } },
    },
    async (req, reply) => {
      const { user, sessionToken } = await service.register(req.body, requestMeta(req), req.auth);
      reply.setSessionCookie(sessionToken);
      return reply.status(201).send({ user: toAuthUser(user) });
    },
  );

  app.post(
    paths.login,
    {
      config: rateLimit,
      schema: { body: loginRequestSchema, response: { 200: meResponseSchema } },
    },
    async (req, reply) => {
      const { user, sessionToken } = await service.login(req.body, requestMeta(req), req.auth);
      reply.setSessionCookie(sessionToken);
      return reply.status(200).send({ user: toAuthUser(user) });
    },
  );

  app.post(paths.logout, async (req, reply) => {
    await service.logout(req.auth, requestMeta(req));
    reply.clearSessionCookie();
    return reply.status(204).send();
  });

  app.get(
    paths.me,
    { preHandler: requireAuth, schema: { response: { 200: meResponseSchema } } },
    async (req) => ({ user: toAuthUser(authOf(req).user) }),
  );

  app.post(
    paths.verifyEmail,
    { config: rateLimit, schema: { body: verifyEmailRequestSchema } },
    async (req, reply) => {
      await service.verifyEmail(req.body.token, requestMeta(req));
      return reply.status(204).send();
    },
  );

  app.post(
    paths.resendVerification,
    { config: rateLimit, preHandler: requireAuth },
    async (req, reply) => {
      await service.resendVerification(authOf(req).user, requestMeta(req));
      return reply.status(204).send();
    },
  );

  app.post(
    paths.passwordResetRequest,
    { config: rateLimit, schema: { body: passwordResetRequestSchema } },
    async (req, reply) => {
      await service.requestPasswordReset(req.body.email, requestMeta(req));
      return reply.status(204).send();
    },
  );

  app.post(
    paths.passwordResetConfirm,
    { config: rateLimit, schema: { body: passwordResetConfirmSchema } },
    async (req, reply) => {
      await service.confirmPasswordReset(req.body.token, req.body.newPassword, requestMeta(req));
      // All sessions were revoked, including this browser's.
      reply.clearSessionCookie();
      return reply.status(204).send();
    },
  );

  app.patch(
    paths.profile,
    {
      preValidation: requireAuth,
      schema: { body: updateProfileRequestSchema, response: { 200: meResponseSchema } },
    },
    async (req) => ({
      user: toAuthUser(await service.updateProfile(authOf(req), req.body.fullName)),
    }),
  );

  app.post(
    paths.password,
    {
      config: rateLimit,
      preValidation: requireAuth,
      schema: { body: changePasswordRequestSchema },
    },
    async (req, reply) => {
      await service.changePassword(
        authOf(req),
        req.body.currentPassword,
        req.body.newPassword,
        requestMeta(req),
      );
      return reply.status(204).send();
    },
  );
};
