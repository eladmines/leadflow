import type { FastifyServerOptions } from 'fastify';
import type { AppConfig } from '../config/env';

/** Paths that must never reach the logs (secrets, credentials, personal tokens). */
export const redactPaths = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
];

export function loggerOptions(config: AppConfig): FastifyServerOptions['logger'] {
  return {
    level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
    redact: { paths: redactPaths, censor: '[REDACTED]' },
    ...(config.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } },
    }),
  };
}
