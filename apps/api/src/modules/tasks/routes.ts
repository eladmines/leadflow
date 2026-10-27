import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createTaskRequestSchema,
  taskListQuerySchema,
  taskListResponseSchema,
  taskResponseSchema,
  updateTaskRequestSchema,
} from '@leadflow/shared';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { TaskService } from './service';

const params = z.object({ businessId: z.string() });
const taskParams = z.object({ businessId: z.string(), taskId: z.string() });

/** Follow-up tasks (F10); registered inside the tenant scope. */
export const taskTenantRoutes: FastifyPluginAsyncZod = async (app) => {
  const tasks = new TaskService(app.prisma);
  const view = { preValidation: requirePermission('tasks.view') };

  app.get(
    '/tasks',
    {
      ...view,
      schema: {
        params,
        querystring: taskListQuerySchema,
        response: { 200: taskListResponseSchema },
      },
    },
    async (req) => ({ tasks: await tasks.list(tenantOf(req), req.query) }),
  );

  app.post(
    '/tasks',
    {
      ...view,
      schema: { params, body: createTaskRequestSchema, response: { 201: taskResponseSchema } },
    },
    async (req, reply) =>
      reply.status(201).send({ task: await tasks.create(tenantOf(req), req.body) }),
  );

  app.patch(
    '/tasks/:taskId',
    {
      ...view,
      schema: {
        params: taskParams,
        body: updateTaskRequestSchema,
        response: { 200: taskResponseSchema },
      },
    },
    async (req) => ({ task: await tasks.update(tenantOf(req), req.params.taskId, req.body) }),
  );

  app.delete('/tasks/:taskId', { ...view, schema: { params: taskParams } }, async (req, reply) => {
    await tasks.remove(tenantOf(req), req.params.taskId);
    return reply.status(204).send();
  });
};
