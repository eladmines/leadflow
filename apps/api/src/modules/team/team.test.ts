import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@leadflow/shared';
import { createTestApp, resetDb } from '../../../test/helpers';
import { newUser, ownerWithBusiness, req } from '../../../test/business-helpers';
import { lastEmailToken, registerUser } from '../../../test/auth-helpers';

const tp = apiPaths.team;

describe('team invitations (F09)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const logs: string[] = [];
  beforeAll(async () => {
    ctx = await createTestApp({
      logStream: new Writable({
        write(chunk, _e, cb) {
          logs.push(String(chunk));
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

  const invite = (id: string, token: string, email: string, role = 'EMPLOYEE') =>
    req(ctx.app, 'POST', tp.invitations(id), token, { email, role });
  const inviteToken = (to: string) => lastEmailToken(ctx.email, to);

  it('invite → email → preview → accept (new account) → member with the role, email verified', async () => {
    const o = await ownerWithBusiness(ctx.app);
    const res = await invite(o.business.id, o.token, ' Yossi@Example.com ');
    expect(res.statusCode).toBe(201);
    expect(res.json().invitation).toMatchObject({ email: 'yossi@example.com', role: 'EMPLOYEE' });

    const mail = ctx.email.to('yossi@example.com').at(-1)!;
    expect(mail.subject).toBe('הוזמנת להצטרף לצוות של מספרת שירן ב-LeadFlow');
    expect(mail.text).toContain('/invite?token=');
    const token = inviteToken('yossi@example.com');

    const preview = await req(ctx.app, 'POST', tp.preview, undefined, { token });
    expect(preview.json().invite).toMatchObject({
      status: 'valid',
      businessName: 'מספרת שירן',
      role: 'EMPLOYEE',
      email: 'yossi@example.com',
    });

    const yossi = await registerUser(ctx.app, {
      email: 'yossi@example.com',
      fullName: 'יוסי מזרחי',
    });
    const accepted = await req(ctx.app, 'POST', tp.accept, yossi.token, { token });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ businessId: o.business.id });

    const biz = await req(ctx.app, 'GET', apiPaths.businesses.detail(o.business.id), yossi.token);
    expect(biz.json().business.role).toBe('EMPLOYEE');
    expect(
      (await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'yossi@example.com' } }))
        .emailVerifiedAt,
    ).not.toBeNull();
    expect(
      (await req(ctx.app, 'POST', tp.preview, undefined, { token })).json().invite.status,
    ).toBe('used');
    expect((await req(ctx.app, 'POST', tp.accept, yossi.token, { token })).statusCode).toBe(400);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: { in: ['member.invited', 'member.joined'] } },
      }),
    ).toBe(2);
  });

  it('refuses to accept with a different account, or without signing in', async () => {
    const o = await ownerWithBusiness(ctx.app);
    await invite(o.business.id, o.token, 'yossi@example.com');
    const token = inviteToken('yossi@example.com');
    const other = await newUser(ctx.app, 'other');
    const res = await req(ctx.app, 'POST', tp.accept, other.token, { token });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/כתובת אימייל אחרת/);
    expect((await req(ctx.app, 'POST', tp.accept, undefined, { token })).statusCode).toBe(401);
    expect(
      (await req(ctx.app, 'POST', tp.preview, undefined, { token: 'A'.repeat(43) })).statusCode,
    ).toBe(404);
  });

  it('re-invite replaces the old link; resend issues a new link; revoke kills it', async () => {
    const o = await ownerWithBusiness(ctx.app);
    const id = o.business.id;
    await invite(id, o.token, 'yossi@example.com');
    const first = inviteToken('yossi@example.com');
    await invite(id, o.token, 'yossi@example.com', 'MANAGER');
    const second = inviteToken('yossi@example.com');
    expect(
      (await req(ctx.app, 'POST', tp.preview, undefined, { token: first })).json().invite.status,
    ).toBe('revoked');

    const list = (await req(ctx.app, 'GET', tp.invitations(id), o.token)).json().invitations;
    expect(list).toHaveLength(1);
    expect(list[0].role).toBe('MANAGER');

    await req(ctx.app, 'POST', tp.resend(id, list[0].id), o.token);
    const third = inviteToken('yossi@example.com');
    expect(third).not.toBe(second);
    expect((await req(ctx.app, 'POST', tp.preview, undefined, { token: second })).statusCode).toBe(
      404,
    );

    expect((await req(ctx.app, 'DELETE', tp.invitation(id, list[0].id), o.token)).statusCode).toBe(
      204,
    );
    expect(
      (await req(ctx.app, 'POST', tp.preview, undefined, { token: third })).json().invite.status,
    ).toBe('revoked');
    expect(
      (await req(ctx.app, 'GET', tp.invitations(id), o.token)).json().invitations,
    ).toHaveLength(0);
  });

  it('rejects inviting an existing member and invalid roles', async () => {
    const o = await ownerWithBusiness(ctx.app);
    const owner = await ctx.prisma.user.findUniqueOrThrow({ where: { id: o.userId } });
    const dup = await invite(o.business.id, o.token, owner.email);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.fields.email).toBeTruthy();
    expect((await invite(o.business.id, o.token, 'x@example.com', 'OWNER')).statusCode).toBe(400);
  });

  async function teamWithEmployee() {
    const o = await ownerWithBusiness(ctx.app);
    await invite(o.business.id, o.token, 'emp@example.com');
    const token = inviteToken('emp@example.com'); // before sign-up sends its own email
    const emp = await registerUser(ctx.app, { email: 'emp@example.com' });
    const accepted = await req(ctx.app, 'POST', tp.accept, emp.token, { token });
    expect(accepted.statusCode).toBe(200);
    return { o, id: o.business.id, emp };
  }

  it('only the owner manages the team; the owner cannot be demoted or removed', async () => {
    const { o, id, emp } = await teamWithEmployee();
    expect((await invite(id, emp.token, 'z@example.com')).statusCode).toBe(403);
    expect((await req(ctx.app, 'GET', tp.invitations(id), emp.token)).statusCode).toBe(403);
    expect(
      (await req(ctx.app, 'PATCH', tp.member(id, o.userId), emp.token, { role: 'MANAGER' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await req(ctx.app, 'PATCH', tp.member(id, o.userId), o.token, { role: 'MANAGER' }))
        .statusCode,
    ).toBe(403);
    expect((await req(ctx.app, 'DELETE', tp.member(id, o.userId), o.token)).statusCode).toBe(403);
  });

  it('changes a role and removes a member (access is gone immediately); a removed member can be re-invited', async () => {
    const { o, id, emp } = await teamWithEmployee();
    expect(
      (await req(ctx.app, 'PATCH', tp.member(id, emp.user.id), o.token, { role: 'MANAGER' }))
        .statusCode,
    ).toBe(204);
    expect(
      (await req(ctx.app, 'GET', apiPaths.businesses.detail(id), emp.token)).json().business.role,
    ).toBe('MANAGER');

    expect((await req(ctx.app, 'DELETE', tp.member(id, emp.user.id), o.token)).statusCode).toBe(
      204,
    );
    expect((await req(ctx.app, 'GET', apiPaths.businesses.detail(id), emp.token)).statusCode).toBe(
      404,
    );
    const members = (await req(ctx.app, 'GET', apiPaths.businesses.members(id), o.token)).json()
      .members;
    expect(members.map((m: { userId: string }) => m.userId)).toEqual([o.userId]);

    await invite(id, o.token, 'emp@example.com');
    await req(ctx.app, 'POST', tp.accept, emp.token, { token: inviteToken('emp@example.com') });
    expect(
      (await req(ctx.app, 'GET', apiPaths.businesses.detail(id), emp.token)).json().business.role,
    ).toBe('EMPLOYEE');
  });

  it('never logs invitation tokens', async () => {
    const o = await ownerWithBusiness(ctx.app);
    await invite(o.business.id, o.token, 'yossi@example.com');
    const token = inviteToken('yossi@example.com');
    await req(ctx.app, 'POST', tp.preview, undefined, { token });
    expect(logs.join('\n')).not.toContain(token);
  });
});
