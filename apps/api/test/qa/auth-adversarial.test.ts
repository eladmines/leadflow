/**
 * QA adversarial tests for F01 (auth). Only gaps not covered by
 * `src/modules/auth/{auth,tokens,security}.test.ts` (token type confusion, concurrent reset
 * confirms, session revocation after reset and cookie attributes are covered there).
 */
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDb, sessionCookie } from '../helpers';
import {
  PASSWORD,
  getMe,
  lastEmailToken,
  paths,
  post,
  registerBody,
  registerUser,
  sessionTokenOf,
} from '../auth-helpers';

describe('QA F01: auth adversarial', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.email.clear();
  });

  it('mass assignment: extra register fields (emailVerified, status, id, role) are ignored', async () => {
    const res = await post(
      ctx.app,
      paths.register,
      registerBody({
        emailVerified: true,
        emailVerifiedAt: new Date().toISOString(),
        status: 'BLOCKED',
        id: '00000000-0000-4000-8000-000000000000',
        role: 'OWNER',
        passwordHash: 'x',
      }),
    );
    // Either stripped (201) or rejected (400) is acceptable; never applied.
    expect([201, 400]).toContain(res.statusCode);
    if (res.statusCode === 201) {
      expect(res.json().user.emailVerified).toBe(false);
      expect(res.json().user.id).not.toBe('00000000-0000-4000-8000-000000000000');
      const user = await ctx.prisma.user.findUniqueOrThrow({
        where: { email: 'dana@example.com' },
      });
      expect(user.emailVerifiedAt).toBeNull();
      expect(user.status).toBe('ACTIVE');
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    }
  });

  it('email variant " Dana@Example.COM " hits the same account on login and reset', async () => {
    const { user } = await registerUser(ctx.app, { email: 'dana@example.com' });
    const variant = ' Dana@Example.COM ';

    const login = await post(ctx.app, paths.login, { email: variant, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.id).toBe(user.id);

    const reset = await post(ctx.app, paths.passwordResetRequest, { email: variant });
    expect(reset.statusCode).toBe(204);
    expect(ctx.email.to('dana@example.com').length).toBe(2); // verify + reset
    const token = lastEmailToken(ctx.email, 'dana@example.com');
    const confirm = await post(ctx.app, paths.passwordResetConfirm, {
      token,
      newPassword: 'An0ther-long-pass',
    });
    expect(confirm.statusCode).toBe(204);
    const again = await post(ctx.app, paths.login, {
      email: '\tDANA@EXAMPLE.COM\n',
      password: 'An0ther-long-pass',
    });
    expect(again.statusCode).toBe(200);
    expect(await ctx.prisma.user.count()).toBe(1);
  });

  it('no response body on any auth route contains passwordHash, tokenHash, status or a raw token', async () => {
    const bodies: LightMyRequestResponse[] = [];
    const reg = await post(ctx.app, paths.register, registerBody());
    bodies.push(reg);
    const session = sessionTokenOf(reg);
    const verifyToken = lastEmailToken(ctx.email, 'dana@example.com');

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'dana@example.com' } });

    bodies.push(await getMe(ctx.app, session));
    bodies.push(
      await post(ctx.app, paths.login, { email: 'dana@example.com', password: PASSWORD }),
    );
    bodies.push(await post(ctx.app, paths.login, { email: 'dana@example.com', password: 'wrong' }));
    bodies.push(await post(ctx.app, paths.resendVerification, undefined, session));
    bodies.push(await post(ctx.app, paths.verifyEmail, { token: verifyToken }));
    bodies.push(await post(ctx.app, paths.verifyEmail, { token: verifyToken })); // 400 reused
    bodies.push(await post(ctx.app, paths.passwordResetRequest, { email: 'dana@example.com' }));
    const resetToken = lastEmailToken(ctx.email, 'dana@example.com');
    bodies.push(
      await post(ctx.app, paths.passwordResetConfirm, { token: resetToken, newPassword: 'short' }),
    );
    bodies.push(
      await post(ctx.app, paths.passwordResetConfirm, {
        token: resetToken,
        newPassword: 'An0ther-long-pass',
      }),
    );
    bodies.push(
      await post(ctx.app, paths.passwordResetConfirm, {
        token: resetToken,
        newPassword: 'An0ther-long-pass',
      }),
    );
    bodies.push(await post(ctx.app, paths.register, registerBody())); // 409
    bodies.push(await post(ctx.app, paths.logout, undefined, session));

    const hashes = [
      ...(await ctx.prisma.authToken.findMany()).map((t) => t.tokenHash),
      ...(await ctx.prisma.session.findMany()).map((t) => t.tokenHash),
    ];
    const secrets = [user.passwordHash, session, verifyToken, resetToken, PASSWORD, ...hashes];
    for (const res of bodies) {
      const text = res.body;
      expect(text).not.toMatch(/passwordHash|password_hash|tokenHash|token_hash/i);
      expect(text).not.toMatch(/"status"\s*:/);
      for (const s of secrets)
        expect(text.includes(s), `${res.statusCode} body leaks a secret`).toBe(false);
    }
  });

  it('every state-changing auth route rejects a missing X-Requested-With with 403', async () => {
    const { token } = await registerUser(ctx.app);
    const routes: [string, unknown][] = [
      [paths.register, registerBody({ email: 'other@example.com' })],
      [paths.login, { email: 'dana@example.com', password: PASSWORD }],
      [paths.logout, undefined],
      [paths.verifyEmail, { token: 'a'.repeat(43) }],
      [paths.resendVerification, undefined],
      [paths.passwordResetRequest, { email: 'dana@example.com' }],
      [paths.passwordResetConfirm, { token: 'a'.repeat(43), newPassword: 'An0ther-long-pass' }],
    ];
    for (const [url, body] of routes) {
      const res = await ctx.app.inject({
        method: 'POST',
        url,
        headers: sessionCookie(token),
        ...(body !== undefined ? { payload: body as object } : {}),
      });
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.code, url).toBe('FORBIDDEN');
    }
    // Nothing happened: session alive, no second user, no reset email.
    expect((await getMe(ctx.app, token)).statusCode).toBe(200);
    expect(await ctx.prisma.user.count()).toBe(1);
    expect(ctx.email.to('dana@example.com')).toHaveLength(1);
  });

  // QA-F01-1 (fixed): an empty JSON body used to be rejected with 400 before the handler ran.
  it('QA-F01-1: logout with Content-Type application/json and an empty body → 204', async () => {
    const { token } = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: paths.logout,
      headers: {
        'x-requested-with': 'LeadFlow',
        'content-type': 'application/json',
        ...sessionCookie(token),
      },
    });
    expect(res.statusCode).toBe(204);
    expect((await getMe(ctx.app, token)).statusCode).toBe(401);
  });
});
