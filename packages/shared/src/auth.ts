import { z } from 'zod';

/**
 * F01 — Authentication & sessions contract.
 *
 * Shared by the API (fastify-type-provider-zod) and the web forms (zodResolver).
 * Rules for these schemas:
 * - No type-changing transforms: input type === output type, so react-hook-form's
 *   `useForm<z.infer<typeof schema>>` works without input/output generics.
 * - Email normalisation uses ZodString's built-in `.trim().toLowerCase()`. These are
 *   string -> string steps (not ZodEffects) and run before the length/format checks.
 *   The server uses the parsed value, so it always stores and looks up the normalised
 *   email. The client gets the normalised value in `handleSubmit` too.
 * - Passwords are never trimmed or otherwise altered.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SESSION_COOKIE_NAME = 'lf_session';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 254;
export const FULL_NAME_MIN_LENGTH = 2;
export const FULL_NAME_MAX_LENGTH = 100;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Sliding idle expiry of a session. */
export const SESSION_IDLE_TTL_MS = 30 * DAY_MS;
/** Hard cap on a session's lifetime, regardless of activity. Also the cookie Max-Age. */
export const SESSION_ABSOLUTE_TTL_MS = 90 * DAY_MS;
export const EMAIL_VERIFY_TOKEN_TTL_MS = 24 * HOUR_MS;
export const PASSWORD_RESET_TOKEN_TTL_MS = 30 * MINUTE_MS;

/**
 * Session, verify and reset tokens are 32 random bytes encoded as base64url without
 * padding, which is always 43 characters.
 */
export const AUTH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** CSRF marker. Every state-changing request must carry this header (non-empty). */
export const CSRF_HEADER_NAME = 'X-Requested-With';
export const CSRF_HEADER_VALUE = 'LeadFlow';

// ---------------------------------------------------------------------------
// API paths
// ---------------------------------------------------------------------------

export const authApiPaths = {
  register: '/api/v1/auth/register',
  login: '/api/v1/auth/login',
  logout: '/api/v1/auth/logout',
  me: '/api/v1/auth/me',
  verifyEmail: '/api/v1/auth/verify-email',
  resendVerification: '/api/v1/auth/resend-verification',
  passwordResetRequest: '/api/v1/auth/password-reset/request',
  passwordResetConfirm: '/api/v1/auth/password-reset/confirm',
  profile: '/api/v1/auth/profile',
  password: '/api/v1/auth/password',
} as const;

/** Web routes that emails link to (APP_URL + path + `?token=`). */
export const authWebPaths = {
  register: '/register',
  login: '/login',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
  /** Signed-in landing page (placeholder until F02 onboarding). */
  appHome: '/app',
} as const;

// ---------------------------------------------------------------------------
// Hebrew messages (validation + expected auth errors)
// ---------------------------------------------------------------------------

export const authMessages = {
  fullNameRequired: 'יש להזין שם מלא',
  fullNameTooShort: `השם המלא צריך להכיל לפחות ${FULL_NAME_MIN_LENGTH} תווים`,
  fullNameTooLong: `השם המלא יכול להכיל עד ${FULL_NAME_MAX_LENGTH} תווים`,
  emailRequired: 'יש להזין כתובת אימייל',
  emailInvalid: 'כתובת האימייל אינה תקינה',
  emailTooLong: `כתובת האימייל יכולה להכיל עד ${EMAIL_MAX_LENGTH} תווים`,
  passwordRequired: 'יש להזין סיסמה',
  passwordTooShort: `הסיסמה צריכה להכיל לפחות ${PASSWORD_MIN_LENGTH} תווים`,
  passwordTooLong: `הסיסמה יכולה להכיל עד ${PASSWORD_MAX_LENGTH} תווים`,
  acceptTermsRequired: 'יש לאשר את תנאי השימוש ומדיניות הפרטיות',
  /** Same text for a missing, malformed, unknown, used or expired token. */
  tokenInvalid: 'הקישור אינו תקף או שפג תוקפו. אפשר לבקש קישור חדש',
  /** 401 on login: identical for an unknown email, a wrong password and a blocked user. */
  invalidCredentials: 'האימייל או הסיסמה שגויים',
  /** 409 on register, returned as `fields.email`. */
  emailTaken: 'כתובת האימייל הזו כבר רשומה. אפשר להתחבר או לאפס סיסמה',
} as const;

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

const requiredString = (message: string) =>
  z.string({ required_error: message, invalid_type_error: message });

/** Trimmed + lowercased, then validated. Order matters: normalise first. */
export const emailSchema = requiredString(authMessages.emailRequired)
  .trim()
  .toLowerCase()
  .min(1, authMessages.emailRequired)
  .max(EMAIL_MAX_LENGTH, authMessages.emailTooLong)
  .email(authMessages.emailInvalid);

/** Password policy for new passwords (register, reset). Not trimmed. */
export const newPasswordSchema = requiredString(authMessages.passwordRequired)
  .min(1, authMessages.passwordRequired)
  .min(PASSWORD_MIN_LENGTH, authMessages.passwordTooShort)
  .max(PASSWORD_MAX_LENGTH, authMessages.passwordTooLong);

/**
 * Password at login: only presence + the max bound (caps hashing cost). The min length is
 * deliberately not enforced, so a policy change never locks out existing users and the
 * login form never hints at the policy.
 */
export const loginPasswordSchema = requiredString(authMessages.passwordRequired)
  .min(1, authMessages.passwordRequired)
  .max(PASSWORD_MAX_LENGTH, authMessages.passwordTooLong);

export const fullNameSchema = requiredString(authMessages.fullNameRequired)
  .trim()
  .min(1, authMessages.fullNameRequired)
  .min(FULL_NAME_MIN_LENGTH, authMessages.fullNameTooShort)
  .max(FULL_NAME_MAX_LENGTH, authMessages.fullNameTooLong);

/** Any malformed token gets the same message as an unknown or expired one. */
export const authTokenSchema = requiredString(authMessages.tokenInvalid).regex(
  AUTH_TOKEN_PATTERN,
  authMessages.tokenInvalid,
);

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const registerRequestSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: newPasswordSchema,
  /**
   * A plain boolean (not `z.literal(true)`) so the form can default it to `false`;
   * the refinement rejects anything but `true`.
   */
  acceptTerms: z
    .boolean({
      required_error: authMessages.acceptTermsRequired,
      invalid_type_error: authMessages.acceptTermsRequired,
    })
    .refine((v) => v === true, { message: authMessages.acceptTermsRequired }),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: loginPasswordSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const verifyEmailRequestSchema = z.object({
  token: authTokenSchema,
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.object({
  token: authTokenSchema,
  newPassword: newPasswordSchema,
});
export type PasswordResetConfirm = z.infer<typeof passwordResetConfirmSchema>;

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

/** The only user shape that leaves the API. Never includes hashes or status internals. */
export const authUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  fullName: z.string(),
  emailVerified: z.boolean(),
  /** ISO-8601 UTC, e.g. `2026-10-27T10:00:00.000Z` (`Date#toISOString()`). */
  createdAt: z.string().datetime(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

/** Body of GET /me, and of 201 register and 200 login. */
export const meResponseSchema = z.object({
  user: authUserSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// ---------------------------------------------------------------------------
// Audit actions recorded by F01
// ---------------------------------------------------------------------------

export const authAuditActions = [
  'auth.register',
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.logout',
  'auth.email_verification.sent',
  'auth.email.verified',
  'auth.password_reset.requested',
  'auth.password_reset.completed',
  'auth.profile.updated',
  'auth.password.changed',
] as const;
export type AuthAuditAction = (typeof authAuditActions)[number];

// ---------------------------------------------------------------------------
// Account settings
// ---------------------------------------------------------------------------

export const accountMessages = {
  currentPasswordWrong: 'הסיסמה הנוכחית שגויה',
  samePassword: 'הסיסמה החדשה זהה לנוכחית',
} as const;

export const updateProfileRequestSchema = z.object({ fullName: fullNameSchema });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/** Changing the password needs the current one; other sessions are signed out. */
export const changePasswordRequestSchema = z.object({
  currentPassword: loginPasswordSchema,
  newPassword: newPasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
