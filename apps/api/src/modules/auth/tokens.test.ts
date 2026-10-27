import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authMessages } from '@leadflow/shared';
import { createTestApp, resetDb } from '../../../test/helpers';
import {
  PASSWORD,
  clearsSessionCookie,
  getMe,
  lastEmailToken,
  paths,
  post,
  registerUser,
  sessionTokenOf,
} from '../../../test/auth-helpers';
import { generateToken, sha256Hex } from '../../lib/crypto';

const EMAIL = 'dana@example.com';
const NEW_PASSWORD = 'Brand-new-passw0rd';

describe('auth: email verification and password reset', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.email.clear();
  });

  const expectTokenInvalid = (res: LightMyRequestResponse) => {
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { token: authMessages.tokenInvalid },
    });
  };
  const expireToken = (token: string) =>
    ctx.prisma.authToken.update({
      where: { tokenHash: sha256Hex(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
  const isVerified = async (id: string) =>
    (await ctx.prisma.user.findUniqueOrThrow({ where: { id } })).emailVerifiedAt !== null;
  const requestReset = (email = EMAIL) => post(ctx.app, paths.passwordResetRequest, { email });
  const login = (password: string) => post(ctx.app, paths.login, { email: EMAIL, password });

  // -------------------------------------------------------------------------
  describe('POST verify-email', () => {
    it('204 without a session: marks the email verified, consumes the token, audits', async () => {
      const { user, token: session } = await registerUser(ctx.app);
      const token = lastEmailToken(ctx.email, EMAIL);

      const res = await post(ctx.app, paths.verifyEmail, { token });
      expect(res.statusCode).toBe(204);
      expect(await isVerified(user.id)).toBe(true);
      expect((await getMe(ctx.app, session)).json().user.emailVerified).toBe(true);

      const row = await ctx.prisma.authToken.findUniqueOrThrow({
        where: { tokenHash: sha256Hex(token) },
      });
      expect(row.usedAt).not.toBeNull();
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.email.verified' },
      });
      expect(audit.entityId).toBe(user.id);
      expect(audit.actorUserId).toBeNull();
    });

    it('a reused token → 400 fields.token', async () => {
      await registerUser(ctx.app);
      const token = lastEmailToken(ctx.email, EMAIL);
      expect((await post(ctx.app, paths.verifyEmail, { token })).statusCode).toBe(204);
      expectTokenInvalid(await post(ctx.app, paths.verifyEmail, { token }));
    });

    it('an expired token → 400 and the email stays unverified', async () => {
      const { user } = await registerUser(ctx.app);
      const token = lastEmailToken(ctx.email, EMAIL);
      await expireToken(token);
      expectTokenInvalid(await post(ctx.app, paths.verifyEmail, { token }));
      expect(await isVerified(user.id)).toBe(false);
    });

    it('malformed, missing and unknown tokens → 400 with the same message', async () => {
      expectTokenInvalid(await post(ctx.app, paths.verifyEmail, { token: 'short' }));
      expectTokenInvalid(await post(ctx.app, paths.verifyEmail, {}));
      expectTokenInvalid(await post(ctx.app, paths.verifyEmail, { token: 'x'.repeat(43) + '!' }));
      expectTokenInvalid(await post(ctx.app, paths.verifyEmail, { token: generateToken() }));
    });

    it('a password-reset token is rejected on verify-email', async () => {
      const { user } = await registerUser(ctx.app);
      await requestReset();
      const resetToken = lastEmailToken(ctx.email, EMAIL);
      expectTokenInvalid(await post(ctx.app, paths.verifyEmail, { token: resetToken }));
      expect(await isVerified(user.id)).toBe(false);
    });

    it('a blocked user’s token is rejected', async () => {
      const { user } = await registerUser(ctx.app);
      const token = lastEmailToken(ctx.email, EMAIL);
      await ctx.prisma.user.update({ where: { id: user.id }, data: { status: 'BLOCKED' } });
      expectTokenInvalid(await post(ctx.app, paths.verifyEmail, { token }));
    });

    it('any unexpired verify link works; after verifying, the others are consumed', async () => {
      const { token: session } = await registerUser(ctx.app);
      const first = lastEmailToken(ctx.email, EMAIL);
      expect((await post(ctx.app, paths.resendVerification, undefined, session)).statusCode).toBe(
        204,
      );
      const second = lastEmailToken(ctx.email, EMAIL);
      expect(second).not.toBe(first);

      // The older link still verifies (D-022) ...
      expect((await post(ctx.app, paths.verifyEmail, { token: first })).statusCode).toBe(204);
      // ... and then the newer one is used up.
      expectTokenInvalid(await post(ctx.app, paths.verifyEmail, { token: second }));
    });
  });

  // -------------------------------------------------------------------------
  describe('POST resend-verification', () => {
    it('401 when anonymous', async () => {
      const res = await post(ctx.app, paths.resendVerification);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('204 + a new email when unverified; audits with trigger resend', async () => {
      const { token: session } = await registerUser(ctx.app);
      const res = await post(ctx.app, paths.resendVerification, undefined, session);
      expect(res.statusCode).toBe(204);
      expect(ctx.email.to(EMAIL)).toHaveLength(2);
      const audits = await ctx.prisma.auditLog.findMany({
        where: { action: 'auth.email_verification.sent' },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits.map((a) => (a.metadata as { trigger: string }).trigger)).toEqual([
        'register',
        'resend',
      ]);
    });

    it('204 and no email when already verified', async () => {
      const { token: session } = await registerUser(ctx.app);
      await post(ctx.app, paths.verifyEmail, { token: lastEmailToken(ctx.email, EMAIL) });
      const res = await post(ctx.app, paths.resendVerification, undefined, session);
      expect(res.statusCode).toBe(204);
      expect(ctx.email.to(EMAIL)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('POST password-reset/request', () => {
    it('204 + email for a known user (email normalised); audits', async () => {
      const { user } = await registerUser(ctx.app);
      ctx.email.clear();
      const res = await requestReset('  DANA@Example.com ');
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      const mails = ctx.email.to(EMAIL);
      expect(mails).toHaveLength(1);
      expect(mails[0]!.subject).toBe('איפוס הסיסמה שלך ב-LeadFlow');
      expect(mails[0]!.text).toMatch(
        /http:\/\/localhost:5173\/reset-password\?token=[A-Za-z0-9_-]{43}/,
      );
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.password_reset.requested' },
      });
      expect(audit.entityId).toBe(user.id);
    });

    it('204, no email and no audit for an unknown email', async () => {
      const res = await requestReset('nobody@example.com');
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      expect(ctx.email.sent).toHaveLength(0);
      expect(await ctx.prisma.auditLog.count()).toBe(0);
    });

    it('204 and no email for a blocked user', async () => {
      const { user } = await registerUser(ctx.app);
      await ctx.prisma.user.update({ where: { id: user.id }, data: { status: 'BLOCKED' } });
      ctx.email.clear();
      expect((await requestReset()).statusCode).toBe(204);
      expect(ctx.email.sent).toHaveLength(0);
    });

    it('204 even when the email fails to send', async () => {
      await registerUser(ctx.app);
      ctx.email.failWith = new Error('smtp down');
      expect((await requestReset()).statusCode).toBe(204);
    });

    it('400 for a malformed email only', async () => {
      const res = await requestReset('not-an-email');
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields).toEqual({ email: authMessages.emailInvalid });
    });

    it('only the newest link works', async () => {
      await registerUser(ctx.app);
      await requestReset();
      const first = lastEmailToken(ctx.email, EMAIL);
      await requestReset();
      const second = lastEmailToken(ctx.email, EMAIL);

      expectTokenInvalid(
        await post(ctx.app, paths.passwordResetConfirm, {
          token: first,
          newPassword: NEW_PASSWORD,
        }),
      );
      expect(
        (
          await post(ctx.app, paths.passwordResetConfirm, {
            token: second,
            newPassword: NEW_PASSWORD,
          })
        ).statusCode,
      ).toBe(204);
    });
  });

  // -------------------------------------------------------------------------
  describe('POST password-reset/confirm', () => {
    it('204: new password works, old fails, all sessions revoked, email verified, audited', async () => {
      const { user, token: s1 } = await registerUser(ctx.app);
      const s2 = sessionTokenOf(await login(PASSWORD));
      await requestReset();
      const token = lastEmailToken(ctx.email, EMAIL);

      const res = await post(
        ctx.app,
        paths.passwordResetConfirm,
        { token, newPassword: NEW_PASSWORD },
        s1,
      );
      expect(res.statusCode).toBe(204);
      expect(clearsSessionCookie(res)).toBe(true);

      expect((await getMe(ctx.app, s1)).statusCode).toBe(401);
      expect((await getMe(ctx.app, s2)).statusCode).toBe(401);
      expect(await ctx.prisma.session.count({ where: { revokedAt: null } })).toBe(0);

      expect((await login(PASSWORD)).statusCode).toBe(401);
      expect((await login(NEW_PASSWORD)).statusCode).toBe(200);

      expect(await isVerified(user.id)).toBe(true);

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.password_reset.completed' },
      });
      expect(audit.entityId).toBe(user.id);
      expect(audit.metadata).toMatchObject({ revokedSessions: 2 });
    });

    it('a reused token is rejected', async () => {
      await registerUser(ctx.app);
      await requestReset();
      const token = lastEmailToken(ctx.email, EMAIL);
      const body = { token, newPassword: NEW_PASSWORD };
      expect((await post(ctx.app, paths.passwordResetConfirm, body)).statusCode).toBe(204);
      expectTokenInvalid(
        await post(ctx.app, paths.passwordResetConfirm, { token, newPassword: 'Another-pass-123' }),
      );
      expect((await login(NEW_PASSWORD)).statusCode).toBe(200);
    });

    it('concurrent confirms with the same token: exactly one succeeds', async () => {
      await registerUser(ctx.app);
      await requestReset();
      const token = lastEmailToken(ctx.email, EMAIL);
      const results = await Promise.all(
        ['Concurrent-pass-1', 'Concurrent-pass-2'].map((newPassword) =>
          post(ctx.app, paths.passwordResetConfirm, { token, newPassword }),
        ),
      );
      expect(results.map((r) => r.statusCode).sort()).toEqual([204, 400]);
    });

    it('an expired token (after 30 min) → 400 and the password is unchanged', async () => {
      await registerUser(ctx.app);
      await requestReset();
      const token = lastEmailToken(ctx.email, EMAIL);
      await expireToken(token);
      expectTokenInvalid(
        await post(ctx.app, paths.passwordResetConfirm, { token, newPassword: NEW_PASSWORD }),
      );
      expect((await login(PASSWORD)).statusCode).toBe(200);
    });

    it('a verify-email token is rejected on reset confirm', async () => {
      await registerUser(ctx.app);
      const verifyToken = lastEmailToken(ctx.email, EMAIL);
      expectTokenInvalid(
        await post(ctx.app, paths.passwordResetConfirm, {
          token: verifyToken,
          newPassword: NEW_PASSWORD,
        }),
      );
    });

    it('400 fields.newPassword for a weak password (token not consumed)', async () => {
      await registerUser(ctx.app);
      await requestReset();
      const token = lastEmailToken(ctx.email, EMAIL);
      const res = await post(ctx.app, paths.passwordResetConfirm, {
        token,
        newPassword: 'short',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields).toEqual({ newPassword: authMessages.passwordTooShort });
      expect(
        (await post(ctx.app, paths.passwordResetConfirm, { token, newPassword: NEW_PASSWORD }))
          .statusCode,
      ).toBe(204);
    });

    it('malformed token → 400 with the same token message', async () => {
      expectTokenInvalid(
        await post(ctx.app, paths.passwordResetConfirm, {
          token: 'nope',
          newPassword: NEW_PASSWORD,
        }),
      );
    });
  });
});
