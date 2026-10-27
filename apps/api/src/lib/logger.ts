import type { FastifyServerOptions } from 'fastify';
import type { AppConfig } from '../config/env';

/** Paths that must never reach the logs (secrets, credentials, personal tokens). */
export const redactPaths = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.passwordHash',
  '*.token',
  '*.tokenHash',
  '*.cookie',
  '*["set-cookie"]',
];

/** A writable destination for log lines (tests capture logs through it). */
export interface LogStream {
  write(line: string): void;
}

/**
 * Logger options. Tests are silent unless they pass a `stream` to capture output, in which
 * case `LOG_LEVEL` applies so a test can capture everything.
 */
export function loggerOptions(
  config: AppConfig,
  stream?: LogStream,
): FastifyServerOptions['logger'] {
  const redact = { paths: redactPaths, censor: '[REDACTED]' };
  if (stream) return { level: config.LOG_LEVEL, redact, stream };
  return {
    level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
    redact,
    ...(config.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } },
    }),
  };
}
