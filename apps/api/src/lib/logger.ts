import type { FastifyServerOptions } from 'fastify';
import type { AppConfig } from '../config/env';

/** Paths that must never reach the logs (secrets, credentials, personal tokens). */
const redactPaths = [
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
  // Email provider credentials (D-120).
  '*.apiKey',
  '*["api-key"]',
  // WhatsApp (F12): Meta's webhook signature and message texts.
  'req.headers["x-hub-signature-256"]',
  '*.body',
  '*.text',
];

/** Hides secret query values in a logged address (Meta's webhook check sends the verify token). */
export const redactUrl = (url: string) =>
  url.replace(/([?&](?:hub\.verify_token|[a-z_]*token)=)[^&]*/gi, '$1[REDACTED]');

/** The request as logged: Fastify's usual fields, with the address's secrets hidden. */
const serializers = {
  req(req: {
    method: string;
    url: string;
    host?: string;
    ip?: string;
    socket?: { remotePort?: number };
  }) {
    return {
      method: req.method,
      url: redactUrl(req.url),
      host: req.host,
      remoteAddress: req.ip,
      remotePort: req.socket?.remotePort,
    };
  },
};

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
  if (stream) return { level: config.LOG_LEVEL, redact, serializers, stream };
  return {
    level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
    redact,
    serializers,
    ...(config.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } },
    }),
  };
}
