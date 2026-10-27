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
