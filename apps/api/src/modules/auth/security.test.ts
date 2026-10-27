import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CSRF_HEADER_NAME, defaultErrorMessages } from '@leadflow/shared';
import {
  TEST_WEB_ORIGIN,
  createTestApp,
  csrfHeaders,
  resetDb,
  testConfig,
} from '../../../test/helpers';
import {
  PASSWORD,
  getMe,
  lastEmailToken,
  paths,
  post,
  registerBody,
  registerUser,
  sessionTokenOf,
} from '../../../test/auth-helpers';

describe('auth: CSRF guard and CORS', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  const expectForbidden = (res: LightMyRequestResponse) => {
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toEqual({
      code: 'FORBIDDEN',
      message: defaultErrorMessages.FORBIDDEN,
      requestId: expect.any(String),
    });
  };

  it('403 without X-Requested-With, checked before validation (no user created)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: paths.register,
      payload: registerBody(),
    });
    expectForbidden(res);
    expect(await ctx.prisma.user.count()).toBe(0);

    // Even an invalid body gets 403, not 400.
    expectForbidden(await ctx.app.inject({ method: 'POST', url: paths.login, payload: {} }));
  });

  it('403 with an empty X-Requested-With', async () => {
    expectForbidden(
      await ctx.app.inject({
        method: 'POST',
        url: paths.logout,
        headers: { [CSRF_HEADER_NAME]: '  ' },
      }),
    );
  });

  it('403 with a foreign Origin even when the header is present', async () => {
    expectForbidden(
      await ctx.app.inject({
        method: 'POST',
        url: paths.register,
        headers: { ...csrfHeaders, origin: 'https://evil.example' },
        payload: registerBody(),
      }),
    );
    expect(await ctx.prisma.user.count()).toBe(0);
  });

  it('403 on logout without the header, so a cross-site form cannot sign users out', async () => {
    const { token } = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: paths.logout,
      headers: { cookie: `lf_session=${token}` },
    });
    expectForbidden(res);
    expect((await getMe(ctx.app, token)).statusCode).toBe(200);
  });

  it('passes with an allowed Origin + header, or with no Origin + header', async () => {
    const withOrigin = await ctx.app.inject({
      method: 'POST',
      url: paths.register,
      headers: { ...csrfHeaders, origin: TEST_WEB_ORIGIN },
      payload: registerBody(),
    });
    expect(withOrigin.statusCode).toBe(201);
    const noOrigin = await post(ctx.app, paths.login, {
      email: 'dana@example.com',
      password: PASSWORD,
    });
    expect(noOrigin.statusCode).toBe(200);
  });

  it('GET /me needs neither the header nor an Origin', async () => {
    const { token } = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'GET',
      url: paths.me,
      headers: { cookie: `lf_session=${token}`, origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('CORS: allowlisted origin gets credentials; a foreign origin gets no CORS headers', async () => {
    const preflight = await ctx.app.inject({
      method: 'OPTIONS',
      url: paths.login,
      headers: {
        origin: TEST_WEB_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-requested-with',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    expect(String(preflight.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'x-requested-with',
    );

    const foreign = await ctx.app.inject({
      method: 'GET',
      url: paths.me,
      headers: { origin: 'https://evil.example' },
    });
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('auth: rate limits', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp({
      config: testConfig({ AUTH_RATE_LIMIT_MAX: '3', AUTH_RATE_LIMIT_WINDOW: '60000' }),
    });
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  it('429 RATE_LIMITED in the shared error shape after the limit; failures count too', async () => {
    const body = { email: 'nobody@example.com', password: 'whatever-pass' };
    for (let i = 0; i < 3; i++) {
      expect((await post(ctx.app, paths.login, body)).statusCode).toBe(401);
    }
    const res = await post(ctx.app, paths.login, body);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: defaultErrorMessages.RATE_LIMITED,
        requestId: expect.any(String),
      },
    });
  });

  it('counts per route: another route is not affected; /me and logout are not limited', async () => {
    const body = { email: 'nobody@example.com' };
    for (let i = 0; i < 3; i++) {
      expect((await post(ctx.app, paths.passwordResetRequest, body)).statusCode).toBe(204);
    }
    expect((await post(ctx.app, paths.passwordResetRequest, body)).statusCode).toBe(429);
    // verify-email has its own counter.
    expect((await post(ctx.app, paths.verifyEmail, { token: 'bad' })).statusCode).toBe(400);

    for (let i = 0; i < 5; i++) {
      expect((await getMe(ctx.app)).statusCode).toBe(401);
      expect((await post(ctx.app, paths.logout)).statusCode).toBe(204);
    }
  });

  it('counts per client IP', async () => {
    const from = (ip: string) =>
      ctx.app.inject({
        method: 'POST',
        url: paths.resendVerification,
        headers: { ...csrfHeaders, 'x-forwarded-for': ip },
      });
    for (let i = 0; i < 3; i++) expect((await from('203.0.113.1')).statusCode).toBe(401);
    expect((await from('203.0.113.1')).statusCode).toBe(429);
    expect((await from('203.0.113.2')).statusCode).toBe(401);
  });
});

describe('auth: logs never contain secrets', () => {
  it('no password, token, session cookie or token hash reaches the logs', async () => {
    const lines: string[] = [];
    const ctx = await createTestApp({
      config: testConfig({ LOG_LEVEL: 'trace' }),
      logStream: { write: (line) => void lines.push(line) },
    });
    try {
      await resetDb(ctx.prisma);
      const email = 'logs@example.com';
      const newPassword = 'Another-Secret-pw-42';

      const reg = await registerUser(ctx.app, { email });
      const session = reg.token;
      const verifyToken = lastEmailToken(ctx.email, email);
      await post(ctx.app, paths.verifyEmail, { token: verifyToken });
      await getMe(ctx.app, session);
      await post(ctx.app, paths.login, { email, password: 'wrong-Password-77' });

      await post(ctx.app, paths.passwordResetRequest, { email });
      const resetToken = lastEmailToken(ctx.email, email);
      await post(ctx.app, paths.passwordResetConfirm, { token: resetToken, newPassword });
      const login = await post(ctx.app, paths.login, { email, password: newPassword });
      const session2 = sessionTokenOf(login);
      await post(ctx.app, paths.logout, undefined, session2);

      // Failing email sends are logged; the token must not be.
      ctx.email.failWith = Object.assign(new Error(`send failed for ${resetToken}`), {
        code: 'ECONNREFUSED',
      });
      await post(ctx.app, paths.passwordResetRequest, { email });
      await new Promise((r) => setTimeout(r, 20));

      // An unexpected error path logs the request too.
      await ctx.app.inject({
        method: 'POST',
        url: paths.login,
        headers: {
          ...csrfHeaders,
          'content-type': 'application/json',
          cookie: `lf_session=${session2}`,
        },
        payload: '{"email": "x", "password": ',
      });

      const log = lines.join('\n');
      expect(lines.length).toBeGreaterThan(10);
      expect(log).toContain('email send failed');
      for (const secret of [
        registerBody().password,
        newPassword,
        'wrong-Password-77',
        session,
        session2,
        verifyToken,
        resetToken,
      ]) {
        expect(log).not.toContain(secret);
      }
      const hashes = await ctx.prisma.session.findMany({ select: { tokenHash: true } });
      const users = await ctx.prisma.user.findMany({ select: { passwordHash: true } });
      for (const h of [...hashes.map((x) => x.tokenHash), ...users.map((u) => u.passwordHash)]) {
        expect(log).not.toContain(h);
      }
      expect(log).not.toMatch(/argon2id/);
    } finally {
      await ctx.close();
    }
  });
});
