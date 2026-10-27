import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  AUTH_TOKEN_PATTERN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_COOKIE_NAME,
  authApiPaths,
  authMessages,
  authUserSchema,
  loginRequestSchema,
  meResponseSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerRequestSchema,
  verifyEmailRequestSchema,
} from './auth';
import { apiPaths } from './api-paths';

const HEBREW = /[֐-׿]/;
const validToken = 'A'.repeat(42) + '_';

const validRegister = {
  fullName: 'דנה כהן',
  email: 'dana@example.com',
  password: 'correct-horse',
  acceptTerms: true,
};

/** First issue message for a path, as the API error handler and zodResolver report it. */
function firstMessage(result: z.SafeParseReturnType<unknown, unknown>, path: string) {
  if (result.success) return undefined;
  return result.error.issues.find((i) => i.path.join('.') === path)?.message;
}

describe('email normalisation', () => {
  it('trims and lowercases before validating', () => {
    const r = loginRequestSchema.parse({ email: '  Dana.Cohen@Example.COM ', password: 'x' });
    expect(r.email).toBe('dana.cohen@example.com');
  });

  it('applies the same normalisation in register and reset request', () => {
    expect(registerRequestSchema.parse({ ...validRegister, email: ' A@B.CO ' }).email).toBe(
      'a@b.co',
    );
    expect(passwordResetRequestSchema.parse({ email: 'A@B.CO' }).email).toBe('a@b.co');
  });

  it('rejects empty, whitespace-only and malformed emails with Hebrew messages', () => {
    expect(firstMessage(loginRequestSchema.safeParse({ email: '', password: 'x' }), 'email')).toBe(
      authMessages.emailRequired,
    );
    expect(
      firstMessage(loginRequestSchema.safeParse({ email: '   ', password: 'x' }), 'email'),
    ).toBe(authMessages.emailRequired);
    expect(
      firstMessage(loginRequestSchema.safeParse({ email: 'not-an-email', password: 'x' }), 'email'),
    ).toBe(authMessages.emailInvalid);
    expect(firstMessage(loginRequestSchema.safeParse({ password: 'x' }), 'email')).toBe(
      authMessages.emailRequired,
    );
  });

  it('enforces the 254-character maximum after trimming', () => {
    const at254 = `${'a'.repeat(254 - '@example.com'.length)}@example.com`;
    expect(at254).toHaveLength(254);
    expect(passwordResetRequestSchema.safeParse({ email: `  ${at254}  ` }).success).toBe(true);
    expect(
      firstMessage(passwordResetRequestSchema.safeParse({ email: `a${at254}` }), 'email'),
    ).toBe(authMessages.emailTooLong);
  });
});

describe('password policy', () => {
  it(`accepts ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters for new passwords`, () => {
    for (const len of [PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH]) {
      expect(
        registerRequestSchema.safeParse({ ...validRegister, password: 'p'.repeat(len) }).success,
      ).toBe(true);
    }
  });

  it('rejects too short, too long and empty new passwords', () => {
    const short = registerRequestSchema.safeParse({
      ...validRegister,
      password: 'p'.repeat(PASSWORD_MIN_LENGTH - 1),
    });
    expect(firstMessage(short, 'password')).toBe(authMessages.passwordTooShort);

    const long = passwordResetConfirmSchema.safeParse({
      token: validToken,
      newPassword: 'p'.repeat(PASSWORD_MAX_LENGTH + 1),
    });
    expect(firstMessage(long, 'newPassword')).toBe(authMessages.passwordTooLong);

    const empty = registerRequestSchema.safeParse({ ...validRegister, password: '' });
    expect(firstMessage(empty, 'password')).toBe(authMessages.passwordRequired);
  });

  it('does not trim passwords', () => {
    const pw = '  spaced password  ';
    expect(registerRequestSchema.parse({ ...validRegister, password: pw }).password).toBe(pw);
    expect(loginRequestSchema.parse({ email: 'a@b.co', password: pw }).password).toBe(pw);
  });

  it('login does not enforce the minimum length, only presence and the maximum', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(true);
    expect(
      firstMessage(loginRequestSchema.safeParse({ email: 'a@b.co', password: '' }), 'password'),
    ).toBe(authMessages.passwordRequired);
    expect(
      loginRequestSchema.safeParse({
        email: 'a@b.co',
        password: 'p'.repeat(PASSWORD_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });
});

describe('register', () => {
  it('accepts a valid request and trims the full name', () => {
    const r = registerRequestSchema.parse({ ...validRegister, fullName: '  דנה כהן ' });
    expect(r.fullName).toBe('דנה כהן');
  });

  it('requires acceptTerms to be exactly true', () => {
    for (const acceptTerms of [false, undefined, 'true', 1]) {
      const r = registerRequestSchema.safeParse({ ...validRegister, acceptTerms });
      expect(firstMessage(r, 'acceptTerms')).toBe(authMessages.acceptTermsRequired);
    }
  });

  it('rejects a whitespace-only or one-character full name', () => {
    expect(
      firstMessage(
        registerRequestSchema.safeParse({ ...validRegister, fullName: '   ' }),
        'fullName',
      ),
    ).toBe(authMessages.fullNameRequired);
    expect(
      firstMessage(
        registerRequestSchema.safeParse({ ...validRegister, fullName: 'ד' }),
        'fullName',
      ),
    ).toBe(authMessages.fullNameTooShort);
  });
});

describe('tokens', () => {
  it('accepts a 43-character base64url token', () => {
    expect(AUTH_TOKEN_PATTERN.test(validToken)).toBe(true);
    expect(verifyEmailRequestSchema.safeParse({ token: validToken }).success).toBe(true);
  });

  it('gives malformed and missing tokens the same "invalid link" message', () => {
    for (const token of [undefined, '', 'short', `${validToken}x`, `${'A'.repeat(42)}=`]) {
      expect(firstMessage(verifyEmailRequestSchema.safeParse({ token }), 'token')).toBe(
        authMessages.tokenInvalid,
      );
    }
  });
});

describe('responses', () => {
  const user = {
    id: '6f1c2b8e-2d3a-4c5b-9e7f-0a1b2c3d4e5f',
    email: 'dana@example.com',
    fullName: 'דנה כהן',
    emailVerified: false,
    createdAt: '2026-10-27T10:00:00.000Z',
  };

  it('accepts a well-formed me response and strips unknown fields', () => {
    const parsed = meResponseSchema.parse({ user: { ...user, passwordHash: 'x' } });
    expect(parsed.user).toEqual(user);
  });

  it('requires an ISO createdAt string', () => {
    expect(authUserSchema.safeParse({ ...user, createdAt: new Date() }).success).toBe(false);
  });
});

describe('constants', () => {
  it('exposes the cookie name, password bounds and paths', () => {
    expect(SESSION_COOKIE_NAME).toBe('lf_session');
    expect([PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH]).toEqual([10, 128]);
    expect(apiPaths.auth).toBe(authApiPaths);
    for (const path of Object.values(authApiPaths)) expect(path).toMatch(/^\/api\/v1\/auth\//);
  });

  it('has a Hebrew text for every auth message', () => {
    for (const message of Object.values(authMessages)) expect(message).toMatch(HEBREW);
  });
});
