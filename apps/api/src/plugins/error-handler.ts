import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { defaultErrorMessages, type ApiErrorBody } from '@leadflow/shared';
import { AppError } from '../lib/errors';

/** Maps every error to the shared `{ error: { code, message, fields? } }` shape. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const requestId = req.id;

    if (hasZodFastifySchemaValidationErrors(err)) {
      const fields: Record<string, string> = {};
      for (const v of err.validation) {
        const path = v.instancePath.replace(/^\//, '').replace(/\//g, '.') || '_';
        fields[path] ??= v.message ?? defaultErrorMessages.VALIDATION_ERROR;
      }
      const body: ApiErrorBody = {
        error: {
          code: 'VALIDATION_ERROR',
          message: defaultErrorMessages.VALIDATION_ERROR,
          fields,
          requestId,
        },
      };
      return reply.status(400).send(body);
    }

    if (err instanceof AppError) {
      const body: ApiErrorBody = {
        error: { code: err.code, message: err.message, fields: err.fields, requestId },
      };
      return reply.status(err.statusCode).send(body);
    }

    if (err.statusCode === 429) {
      return reply.status(429).send({
        error: { code: 'RATE_LIMITED', message: defaultErrorMessages.RATE_LIMITED, requestId },
      } satisfies ApiErrorBody);
    }

    // Malformed JSON and other client errors raised by Fastify itself.
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: defaultErrorMessages.VALIDATION_ERROR,
          requestId,
        },
      } satisfies ApiErrorBody);
    }

    // Unexpected: log full details, return nothing internal to the client.
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: defaultErrorMessages.INTERNAL_ERROR, requestId },
    } satisfies ApiErrorBody);
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: defaultErrorMessages.NOT_FOUND, requestId: req.id },
    } satisfies ApiErrorBody);
  });
}
