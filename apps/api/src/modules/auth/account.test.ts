import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDb } from '../../../test/helpers';
import {
  getMe,
  paths,
  PASSWORD,
  post,
  registerUser,
  sessionTokenOf,
} from '../../../test/auth-helpers';
import { req } from '../../../test/business-helpers';

describe('account settings', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const logs: string[] = [];
  beforeAll(async () => {
    ctx = await createTestApp({
      logStream: new Writable({
        write(c, _e, cb) {
          logs.push(String(c));
          cb();
        },
      }),
    });
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.email.clear();
    logs.length = 0;
  });

  it('updates the name (validated) and returns the user', async () => {
    const { token } = await registerUser(ctx.app);
    const res = await req(ctx.app, 'PATCH', paths.profile, token, { fullName: '  דנה לוי ' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.fullName).toBe('דנה לוי');
    expect((await req(ctx.app, 'PATCH', paths.profile, token, { fullName: 'א' })).statusCode).toBe(
      400,
    );
    expect(
      (await req(ctx.app, 'PATCH', paths.profile, undefined, { fullName: 'דנה' })).statusCode,
    ).toBe(401);
  });

  it('changes the password: needs the current one, signs out other devices, keeps this one, sends a notice', async () => {
    const { token: here } = await registerUser(ctx.app, { email: 'dana@example.com' });
    const otherLogin = await post(ctx.app, paths.login, {
      email: 'dana@example.com',
      password: PASSWORD,
    });
    const there = sessionTokenOf(otherLogin);
    ctx.email.clear();

    const wrong = await req(ctx.app, 'POST', paths.password, here, {
      currentPassword: 'not-the-password',
      newPassword: 'Brand-new-pass-1',
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.fields.currentPassword).toBe('הסיסמה הנוכחית שגויה');
    const same = await req(ctx.app, 'POST', paths.password, here, {
      currentPassword: PASSWORD,
      newPassword: PASSWORD,
    });
    expect(same.json().error.fields.newPassword).toBeTruthy();

    const ok = await req(ctx.app, 'POST', paths.password, here, {
      currentPassword: PASSWORD,
      newPassword: 'Brand-new-pass-1',
    });
    expect(ok.statusCode).toBe(204);
    expect((await getMe(ctx.app, here)).statusCode).toBe(200);
    expect((await getMe(ctx.app, there)).statusCode).toBe(401);

    expect(
      (await post(ctx.app, paths.login, { email: 'dana@example.com', password: PASSWORD }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await post(ctx.app, paths.login, {
          email: 'dana@example.com',
          password: 'Brand-new-pass-1',
        })
      ).statusCode,
    ).toBe(200);

    const notice = ctx.email.to('dana@example.com').at(-1)!;
    expect(notice.subject).toBe('הסיסמה שלך ב-LeadFlow שונתה');
    expect(notice.text).toContain('/forgot-password');
    expect(logs.join('\n')).not.toContain('Brand-new-pass-1');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.password.changed' } })).toBe(1);
  });
});
