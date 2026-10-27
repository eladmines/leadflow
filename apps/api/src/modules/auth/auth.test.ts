import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_COOKIE_NAME,
  authMessages,
  defaultErrorMessages,
} from '@leadflow/shared';
import { createTestApp, resetDb, testConfig } from '../../../test/helpers';
import {
  PASSWORD,
  clearsSessionCookie,
  getMe,
  paths,
  post,
  registerBody,
  registerUser,
  sessionCookieOf,
  sessionTokenOf,
} from '../../../test/auth-helpers';
import { generateToken, sha256Hex } from '../../lib/crypto';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('auth: register, login, sessions', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.email.clear();
  });

  const sessionRow = (token: string) =>
    ctx.prisma.session.findUniqueOrThrow({ where: { tokenHash: sha256Hex(token) } });

  // -------------------------------------------------------------------------
  describe('POST register', () => {
    it('201: returns the user, sets the session cookie, sends a verify email, audits', async () => {
      const res = await post(ctx.app, paths.register, registerBody());
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toEqual({
        user: {
          id: expect.any(String),
          email: 'dana@example.com',
          fullName: 'דנה כהן',
          emailVerified: false,
          createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        },
      });

      const cookie = sessionCookieOf(res)!;
      expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.sameSite).toBe('Lax');
      expect(cookie.path).toBe('/');
      expect(cookie.maxAge).toBe(SESSION_ABSOLUTE_TTL_MS / 1000);
      expect(cookie.secure).toBeFalsy();
      expect(cookie.domain).toBeUndefined();

      // Only the hash is stored.
      const session = await sessionRow(cookie.value);
      expect(session.userId).toBe(body.user.id);
      expect(session.ip).toBeTruthy();

      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: body.user.id } });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.status).toBe('ACTIVE');
      expect(user.emailVerifiedAt).toBeNull();

      const mails = ctx.email.to('dana@example.com');
      expect(mails).toHaveLength(1);
      expect(mails[0]!.subject).toBe('אימות כתובת האימייל שלך ב-LeadFlow');
      expect(mails[0]!.text).toMatch(
        /http:\/\/localhost:5173\/verify-email\?token=[A-Za-z0-9_-]{43}/,
      );

      const actions = (await ctx.prisma.auditLog.findMany()).map((a) => a.action).sort();
      expect(actions).toEqual(['auth.email_verification.sent', 'auth.register']);
      const reg = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.register' },
      });
      expect(reg.actorUserId).toBe(body.user.id);
      expect(reg.businessId).toBeNull();
      expect(Object.keys(reg.metadata as object).sort()).toEqual(['ip', 'userAgent']);
    });

    it('sets Secure on the cookie when COOKIE_SECURE=true', async () => {
      const secure = await createTestApp({ config: testConfig({ COOKIE_SECURE: 'true' }) });
      try {
        const res = await post(secure.app, paths.register, registerBody());
        expect(res.statusCode).toBe(201);
        expect(sessionCookieOf(res)!.secure).toBe(true);
      } finally {
        await secure.close();
      }
    });

    it('normalises the email: case and whitespace insensitive at register and login', async () => {
      const res = await post(ctx.app, paths.register, registerBody({ email: '  Dana@X.com ' }));
      expect(res.statusCode).toBe(201);
      expect(res.json().user.email).toBe('dana@x.com');

      const login = await post(ctx.app, paths.login, { email: 'dana@x.com', password: PASSWORD });
      expect(login.statusCode).toBe(200);

      const dup = await post(ctx.app, paths.register, registerBody({ email: 'DANA@x.com' }));
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error.fields).toEqual({ email: authMessages.emailTaken });
    });

    it('409 CONFLICT with fields.email for a duplicate email; no cookie', async () => {
      await registerUser(ctx.app);
      const res = await post(ctx.app, paths.register, registerBody());
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({
        error: {
          code: 'CONFLICT',
          message: defaultErrorMessages.CONFLICT,
          fields: { email: authMessages.emailTaken },
          requestId: expect.any(String),
        },
      });
      expect(sessionCookieOf(res)).toBeUndefined();
    });

    it('409 on concurrent registrations of the same email (unique race)', async () => {
      const results = await Promise.all(
        [1, 2, 3].map(() => post(ctx.app, paths.register, registerBody())),
      );
      const statuses = results.map((r) => r.statusCode).sort();
      expect(statuses).toEqual([201, 409, 409]);
      expect(await ctx.prisma.user.count()).toBe(1);
    });

    it.each([
      ['a 9-char password', { password: '123456789' }, 'password', authMessages.passwordTooShort],
      [
        'a 129-char password',
        { password: 'x'.repeat(129) },
        'password',
        authMessages.passwordTooLong,
      ],
      [
        'acceptTerms false',
        { acceptTerms: false },
        'acceptTerms',
        authMessages.acceptTermsRequired,
      ],
      ['an invalid email', { email: 'not-an-email' }, 'email', authMessages.emailInvalid],
      ['a 1-char name', { fullName: ' ד ' }, 'fullName', authMessages.fullNameTooShort],
    ])('400 VALIDATION_ERROR with a Hebrew field message for %s', async (_l, o, field, msg) => {
      const res = await post(ctx.app, paths.register, registerBody(o));
      expect(res.statusCode).toBe(400);
      const err = res.json().error;
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.fields[field]).toBe(msg);
      expect(await ctx.prisma.user.count()).toBe(0);
    });

    it('400 with all missing fields reported', async () => {
      const res = await post(ctx.app, paths.register, {});
      expect(res.statusCode).toBe(400);
      expect(Object.keys(res.json().error.fields).sort()).toEqual([
        'acceptTerms',
        'email',
        'fullName',
        'password',
      ]);
    });

    it('still succeeds when the verification email fails to send', async () => {
      ctx.email.failWith = new Error('smtp down');
      const res = await post(ctx.app, paths.register, registerBody());
      expect(res.statusCode).toBe(201);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.register' } })).toBe(1);
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'auth.email_verification.sent' } }),
      ).toBe(0);
    });

    it('register while signed in revokes the previous session', async () => {
      const first = await registerUser(ctx.app);
      const res = await post(
        ctx.app,
        paths.register,
        registerBody({ email: 'other@example.com' }),
        first.token,
      );
      expect(res.statusCode).toBe(201);
      expect((await sessionRow(first.token)).revokedAt).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('POST login', () => {
    it('200: returns the user and sets a new session cookie; audits success', async () => {
      const { user } = await registerUser(ctx.app);
      const res = await post(ctx.app, paths.login, {
        email: 'dana@example.com',
        password: PASSWORD,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().user.id).toBe(user.id);
      const token = sessionTokenOf(res);
      expect((await getMe(ctx.app, token)).statusCode).toBe(200);

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.login.succeeded' },
      });
      const session = await sessionRow(token);
      expect(audit.actorUserId).toBe(user.id);
      expect(audit.metadata).toMatchObject({ sessionId: session.id });
    });

    it('unknown email, wrong password and a blocked user give the identical 401', async () => {
      const { user } = await registerUser(ctx.app);
      await registerUser(ctx.app, { email: 'blocked@example.com' });
      await ctx.prisma.user.update({
        where: { email: 'blocked@example.com' },
        data: { status: 'BLOCKED' },
      });

      const attempts = [
        { email: 'nobody@example.com', password: PASSWORD },
        { email: 'dana@example.com', password: 'wrong-password-1' },
        { email: 'blocked@example.com', password: PASSWORD },
      ];
      const bodies = [];
      for (const a of attempts) {
        const res = await post(ctx.app, paths.login, a);
        expect(res.statusCode).toBe(401);
        expect(sessionCookieOf(res)).toBeUndefined();
        const { code, message, fields } = res.json().error;
        bodies.push({ code, message, fields });
      }
      expect(bodies[0]).toEqual({
        code: 'UNAUTHENTICATED',
        message: authMessages.invalidCredentials,
        fields: undefined,
      });
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[2]).toEqual(bodies[0]);

      const failed = await ctx.prisma.auditLog.findMany({
        where: { action: 'auth.login.failed' },
        orderBy: { createdAt: 'asc' },
      });
      expect(failed.map((f) => (f.metadata as { reason: string }).reason)).toEqual([
        'unknown_email',
        'bad_password',
        'blocked',
      ]);
      expect(failed[0]!.entityId).toBeNull();
      expect(failed[1]!.entityId).toBe(user.id);
      for (const f of failed) {
        expect(f.actorUserId).toBeNull();
        expect(Object.keys(f.metadata as object).sort()).toEqual(['ip', 'reason', 'userAgent']);
        expect(JSON.stringify(f.metadata)).not.toMatch(/example\.com|Sup3r|wrong-password/);
      }
    });

    it('does not apply the new-password minimum at login (no policy hint)', async () => {
      const res = await post(ctx.app, paths.login, { email: 'dana@example.com', password: 'x' });
      expect(res.statusCode).toBe(401);
    });

    it('400 for a missing password or malformed email', async () => {
      const res = await post(ctx.app, paths.login, { email: 'nope' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields).toEqual({
        email: authMessages.emailInvalid,
        password: authMessages.passwordRequired,
      });
    });

    it('login while signed in revokes the previous session', async () => {
      const { token: first } = await registerUser(ctx.app);
      const res = await post(
        ctx.app,
        paths.login,
        { email: 'dana@example.com', password: PASSWORD },
        first,
      );
      expect(res.statusCode).toBe(200);
      const second = sessionTokenOf(res);
      expect(second).not.toBe(first);
      expect((await getMe(ctx.app, first)).statusCode).toBe(401);
      expect((await getMe(ctx.app, second)).statusCode).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET me and session validity', () => {
    it('401 without a cookie (and sets no cookie)', async () => {
      const res = await getMe(ctx.app);
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatchObject({
        code: 'UNAUTHENTICATED',
        message: defaultErrorMessages.UNAUTHENTICATED,
      });
      expect(sessionCookieOf(res)).toBeUndefined();
    });

    it('200 with a valid cookie; the body never leaks internals', async () => {
      const { token, user } = await registerUser(ctx.app);
      const res = await getMe(ctx.app, token);
      expect(res.statusCode).toBe(200);
      expect(res.json().user).toMatchObject({ id: user.id, emailVerified: false });
      expect(res.body).not.toMatch(/passwordHash|tokenHash|status|argon2/);
      expect(sessionCookieOf(res)).toBeUndefined();
    });

    it('401 and clears the cookie for an idle-expired session', async () => {
      const { token } = await registerUser(ctx.app);
      await ctx.prisma.session.update({
        where: { tokenHash: sha256Hex(token) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await getMe(ctx.app, token);
      expect(res.statusCode).toBe(401);
      expect(clearsSessionCookie(res)).toBe(true);
    });

    it('401 and clears the cookie for an absolute-expired session', async () => {
      const { token } = await registerUser(ctx.app);
      await ctx.prisma.session.update({
        where: { tokenHash: sha256Hex(token) },
        data: { absoluteExpiresAt: new Date(Date.now() - 1000) },
      });
      const res = await getMe(ctx.app, token);
      expect(res.statusCode).toBe(401);
      expect(clearsSessionCookie(res)).toBe(true);
    });

    it('401 and clears the cookie for a revoked session', async () => {
      const { token } = await registerUser(ctx.app);
      await ctx.prisma.session.update({
        where: { tokenHash: sha256Hex(token) },
        data: { revokedAt: new Date() },
      });
      const res = await getMe(ctx.app, token);
      expect(res.statusCode).toBe(401);
      expect(clearsSessionCookie(res)).toBe(true);
    });

    it('401 and clears the cookie for a tampered or unknown token', async () => {
      const { token } = await registerUser(ctx.app);
      const tampered = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
      for (const t of [tampered, generateToken(), 'garbage', token + 'x']) {
        const res = await getMe(ctx.app, t);
        expect(res.statusCode).toBe(401);
        expect(clearsSessionCookie(res)).toBe(true);
      }
    });

    it('401 and clears the cookie when the user is blocked', async () => {
      const { token, user } = await registerUser(ctx.app);
      await ctx.prisma.user.update({ where: { id: user.id }, data: { status: 'BLOCKED' } });
      const res = await getMe(ctx.app, token);
      expect(res.statusCode).toBe(401);
      expect(clearsSessionCookie(res)).toBe(true);
    });

    it('sliding: a request after > 1 h moves expires_at, at most hourly', async () => {
      const { token } = await registerUser(ctx.app);
      const twoHoursAgo = new Date(Date.now() - 2 * HOUR);
      await ctx.prisma.session.update({
        where: { tokenHash: sha256Hex(token) },
        data: { lastSeenAt: twoHoursAgo, expiresAt: new Date(Date.now() + 1 * DAY) },
      });

      const before = Date.now();
      expect((await getMe(ctx.app, token)).statusCode).toBe(200);
      const touched = await sessionRow(token);
      expect(touched.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before - 5);
      expect(touched.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 30 * DAY - 5);

      // Within the hour: no further write.
      expect((await getMe(ctx.app, token)).statusCode).toBe(200);
      const again = await sessionRow(token);
      expect(again.lastSeenAt.getTime()).toBe(touched.lastSeenAt.getTime());
    });

    it('sliding never extends past absolute_expires_at', async () => {
      const { token } = await registerUser(ctx.app);
      const absolute = new Date(Date.now() + 2 * DAY);
      await ctx.prisma.session.update({
        where: { tokenHash: sha256Hex(token) },
        data: {
          lastSeenAt: new Date(Date.now() - 2 * HOUR),
          expiresAt: new Date(Date.now() + DAY),
          absoluteExpiresAt: absolute,
        },
      });
      expect((await getMe(ctx.app, token)).statusCode).toBe(200);
      const row = await sessionRow(token);
      expect(row.expiresAt.getTime()).toBe(absolute.getTime());
    });

    it('a sliding touch does not re-send the cookie', async () => {
      const { token } = await registerUser(ctx.app);
      await ctx.prisma.session.update({
        where: { tokenHash: sha256Hex(token) },
        data: { lastSeenAt: new Date(Date.now() - 2 * HOUR) },
      });
      const res = await getMe(ctx.app, token);
      expect(res.statusCode).toBe(200);
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('POST logout', () => {
    it('204, revokes the session server-side, clears the cookie, audits', async () => {
      const { token, user } = await registerUser(ctx.app);
      const res = await post(ctx.app, paths.logout, undefined, token);
      expect(res.statusCode).toBe(204);
      expect(clearsSessionCookie(res)).toBe(true);
      expect((await sessionRow(token)).revokedAt).not.toBeNull();
      // The old cookie is useless now, even if the browser kept it.
      expect((await getMe(ctx.app, token)).statusCode).toBe(401);

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.logout' },
      });
      expect(audit.actorUserId).toBe(user.id);
      expect(audit.entityType).toBe('session');
    });

    it('is idempotent: 204 without a cookie or with an invalid one', async () => {
      const none = await post(ctx.app, paths.logout);
      expect(none.statusCode).toBe(204);
      expect(clearsSessionCookie(none)).toBe(true);

      const bad = await post(ctx.app, paths.logout, undefined, generateToken());
      expect(bad.statusCode).toBe(204);
      expect(clearsSessionCookie(bad)).toBe(true);
      // One Set-Cookie for lf_session, not two.
      const setCookie = [bad.headers['set-cookie']].flat();
      expect(setCookie.filter((c) => c?.startsWith(`${SESSION_COOKIE_NAME}=`))).toHaveLength(1);
    });

    it('logging out one session leaves the user’s other sessions alive', async () => {
      const { token: a } = await registerUser(ctx.app);
      const login = await post(ctx.app, paths.login, {
        email: 'dana@example.com',
        password: PASSWORD,
      });
      const b = sessionTokenOf(login);
      await post(ctx.app, paths.logout, undefined, a);
      expect((await getMe(ctx.app, a)).statusCode).toBe(401);
      expect((await getMe(ctx.app, b)).statusCode).toBe(200);
    });
  });
});
