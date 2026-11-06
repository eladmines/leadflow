import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Explicit boolean parsing. `z.coerce.boolean()` would turn the string 'false' into `true`,
 * so only the literal strings 'true' and 'false' are accepted.
 */
const booleanString = z
  .enum(['true', 'false'], { message: "must be 'true' or 'false'" })
  .transform((v) => v === 'true');

/** Optional setting where an empty value (`KEY=` in .env) means "not set". */
const optionalSetting = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.string().url(),
    /** Defaults to APP_URL's origin (the web app served from this port, D-119). */
    WEB_ORIGINS: z
      .string()
      .optional()
      .transform((v) =>
        v
          ?.split(',')
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
    /**
     * smtp (Mailpit locally) · brevo (HTTPS API, for hosts that block SMTP, D-120) · disabled
     * (send nothing yet) · memory (tests only).
     */
    EMAIL_TRANSPORT: z.enum(['smtp', 'brevo', 'disabled', 'memory']).default('smtp'),
    BREVO_API_KEY: optionalSetting(z.string().min(10)),
    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    /** Login for a real mail server (e.g. Gmail with an app password, D-119); unset for Mailpit. */
    SMTP_USER: optionalSetting(z.string().min(1)),
    SMTP_PASS: optionalSetting(z.string().min(1)),
    /** TLS from the first byte (port 465). Port 587 upgrades with STARTTLS on its own. */
    SMTP_SECURE: booleanString.default('false'),
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
    /**
     * `host`: each site on its own subdomain (needs a wildcard domain). `path`: sites under
     * APP_URL/s/<subdomain> on the app's own port — for hosting without a domain (D-119).
     */
    PUBLIC_SITE_MODE: z.enum(['host', 'path']).default('host'),
    /** Built web app (apps/web/dist) to serve from the API's port; unset = served separately. */
    WEB_DIST_DIR: optionalSetting(z.string().min(1)),

    // F07 — Lead forms
    /** HMAC secret for public form tokens (≥ 32 chars). Random per boot outside production. */
    FORM_TOKEN_SECRET: z.string().min(32).optional(),
    /** Accepted form submissions per visitor IP per site per window. */
    LEAD_FORM_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    LEAD_FORM_RATE_LIMIT_WINDOW: z.coerce.number().int().positive().default(600_000),

    // F05 — Media
    /** `disk`: MEDIA_DIR. `database`: in Postgres, for hosts whose disk is wiped on restart (D-119). */
    STORAGE_DRIVER: z.enum(['disk', 'database']).default('disk'),
    /** Local folder for uploaded images (dev/test). */
    MEDIA_DIR: z.string().min(1).default('.data/media'),
    /** URL prefix images are served from: same-origin `/media` locally, a CDN origin in production. */
    MEDIA_PUBLIC_BASE: z.string().min(1).default('/media'),
    /** Storage quota per business, in bytes (plan quotas arrive with F13). */
    MEDIA_QUOTA_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(200 * 1024 * 1024),
    /** New sites start with the template's sample photos (D-069). Tests turn it off. */
    SITE_STOCK_IMAGES: booleanString.default('true'),
    /** Folder with the bundled sample photos (relative to the API's working directory). */
    SITE_STOCK_DIR: z.string().min(1).default('assets/stock'),

    // F12 POC — WhatsApp (D-091). One number, connected to one business, from the environment.
    /** `local` records outgoing messages without calling Meta; `cloud` uses the Graph API. */
    WHATSAPP_PROVIDER: z.enum(['local', 'cloud']).default('local'),
    /** LeadFlow business the WhatsApp number belongs to; unset = WhatsApp off. */
    WHATSAPP_BUSINESS_ID: optionalSetting(z.string().uuid()),
    /** Meta "Phone number ID" (not the phone number itself). */
    WHATSAPP_PHONE_NUMBER_ID: optionalSetting(z.string().min(1)),
    WHATSAPP_ACCESS_TOKEN: optionalSetting(z.string().min(1)),
    /** Meta app secret: verifies the X-Hub-Signature-256 of every webhook call. */
    WHATSAPP_APP_SECRET: optionalSetting(z.string().min(16)),
    /** Word Meta echoes back when the webhook is registered. */
    WHATSAPP_VERIFY_TOKEN: optionalSetting(z.string().min(8)),
    WHATSAPP_GRAPH_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .default('v21.0'),
  })
  .superRefine((env, ctx) => {
    if (env.WHATSAPP_BUSINESS_ID) {
      const required = ['WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'] as const;
      const cloud = ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'] as const;
      for (const key of [...required, ...(env.WHATSAPP_PROVIDER === 'cloud' ? cloud : [])]) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'is required when WHATSAPP_BUSINESS_ID is set',
          });
        }
      }
    }
    if (env.EMAIL_TRANSPORT === 'brevo' && !env.BREVO_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BREVO_API_KEY'],
        message: "is required when EMAIL_TRANSPORT is 'brevo'",
      });
    }
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
    WEB_ORIGINS: env.WEB_ORIGINS?.length
      ? env.WEB_ORIGINS
      : [new URL(env.APP_URL ?? 'http://localhost:5173').origin],
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    PUBLIC_SITE_PROTOCOL:
      env.PUBLIC_SITE_PROTOCOL ?? (env.NODE_ENV === 'production' ? 'https' : 'http'),
    FORM_TOKEN_SECRET: env.FORM_TOKEN_SECRET ?? randomBytes(32).toString('base64url'),
  }));

export type AppConfig = z.infer<typeof envSchema>;

/** Parses and validates environment variables; fails fast on misconfiguration. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Render gives every service its public address; use it when APP_URL isn't set (D-119).
  const source =
    !env.APP_URL && env.RENDER_EXTERNAL_URL ? { ...env, APP_URL: env.RENDER_EXTERNAL_URL } : env;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}
