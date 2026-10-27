import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Explicit boolean parsing. `z.coerce.boolean()` would turn the string 'false' into `true`,
 * so only the literal strings 'true' and 'false' are accepted.
 */
const booleanString = z
  .enum(['true', 'false'], { message: "must be 'true' or 'false'" })
  .transform((v) => v === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.string().url(),
    WEB_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),

    // F01 — Authentication & sessions
    /** Base URL of the web app, used in email links. No trailing slash. */
    APP_URL: z
      .string()
      .url()
      .transform((v) => v.replace(/\/+$/, ''))
      .optional(),
    /** Defaults to true in production, false elsewhere. */
    COOKIE_SECURE: booleanString.optional(),
    EMAIL_TRANSPORT: z.enum(['smtp', 'memory']).default('smtp'),
    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    EMAIL_FROM: z.string().min(1).default('LeadFlow <no-reply@leadflow.local>'),
    /** Requests per client IP per route per window, on rate-limited auth routes. */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    /** Rate-limit window in milliseconds. */
    AUTH_RATE_LIMIT_WINDOW: z.coerce.number().int().positive().default(900_000),

    // F06 — Published sites
    /** Port of the public-site server (customer sites by Host header). */
    PUBLIC_PORT: z.coerce.number().int().positive().default(4100),
    /**
     * Host suffix of customer sites as visitors type it, including a port if any.
     * Local: lvh.me (wildcard DNS → 127.0.0.1) on PUBLIC_PORT. Production: e.g. leadflow.co.il.
     */
    PUBLIC_SITE_HOST: z
      .string()
      .regex(/^[a-z0-9.-]+(:\d+)?$/i)
      .default('lvh.me:4100'),
    PUBLIC_SITE_PROTOCOL: z.enum(['http', 'https']).optional(),

    // F07 — Lead forms
    /** HMAC secret for public form tokens (≥ 32 chars). Random per boot outside production. */
    FORM_TOKEN_SECRET: z.string().min(32).optional(),
    /** Accepted form submissions per visitor IP per site per window. */
    LEAD_FORM_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    LEAD_FORM_RATE_LIMIT_WINDOW: z.coerce.number().int().positive().default(600_000),

    // F05 — Media
    /** Local folder for uploaded images (dev/test). Production uses object storage (R2). */
    MEDIA_DIR: z.string().min(1).default('.data/media'),
    /** URL prefix images are served from: same-origin `/media` locally, a CDN origin in production. */
    MEDIA_PUBLIC_BASE: z.string().min(1).default('/media'),
    /** Storage quota per business, in bytes (plan quotas arrive with F13). */
    MEDIA_QUOTA_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(200 * 1024 * 1024),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (!env.APP_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_URL'],
        message: 'is required in production',
      });
    }
    if (env.COOKIE_SECURE === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'must be true in production',
      });
    }
    if (!env.FORM_TOKEN_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FORM_TOKEN_SECRET'],
        message: 'is required in production',
      });
    }
    if (env.EMAIL_TRANSPORT === 'memory') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_TRANSPORT'],
        message: "'memory' is not allowed in production",
      });
    }
  })
  .transform((env) => ({
    ...env,
    APP_URL: env.APP_URL ?? 'http://localhost:5173',
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    PUBLIC_SITE_PROTOCOL:
      env.PUBLIC_SITE_PROTOCOL ?? (env.NODE_ENV === 'production' ? 'https' : 'http'),
    FORM_TOKEN_SECRET: env.FORM_TOKEN_SECRET ?? randomBytes(32).toString('base64url'),
  }));

export type AppConfig = z.infer<typeof envSchema>;

/** Parses and validates environment variables; fails fast on misconfiguration. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}
