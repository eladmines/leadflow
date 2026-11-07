import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiPaths } from '@leadflow/shared';
import { createTestApp, testConfig } from '../../../test/helpers';
import { newUser, req } from '../../../test/business-helpers';

/** D-122, D-133: verification only when turned on and email goes out. */
describe('email verification follows the settings', () => {
  let on: Awaited<ReturnType<typeof createTestApp>>;
  let off: Awaited<ReturnType<typeof createTestApp>>;
  let turnedOff: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    on = await createTestApp();
    off = await createTestApp({ config: testConfig({ EMAIL_TRANSPORT: 'disabled' }) });
    turnedOff = await createTestApp({ config: testConfig({ EMAIL_VERIFICATION: 'off' }) });
  });
  afterAll(async () => {
    await on.close();
    await off.close();
    await turnedOff.close();
  });

  it('is off unless turned on (D-133)', () => {
    expect(testConfig({ EMAIL_VERIFICATION: undefined }).EMAIL_VERIFICATION).toBe('off');
  });

  it("doesn't ask or send a verify email when turned off (D-133)", async () => {
    const u = await newUser(turnedOff.app, 'verify-turned-off');
    const res = await req(turnedOff.app, 'GET', apiPaths.auth.me, u.token);
    expect(res.json()).toMatchObject({ emailVerification: false });
    const resend = await req(turnedOff.app, 'POST', apiPaths.auth.resendVerification, u.token);
    expect(resend.statusCode).toBeLessThan(300);
    expect(turnedOff.email.sent).toHaveLength(0);
  });

  it('asks for verification when email is sent', async () => {
    const u = await newUser(on.app, 'verify-on');
    const res = await req(on.app, 'GET', apiPaths.auth.me, u.token);
    expect(res.json()).toMatchObject({ user: { emailVerified: false }, emailVerification: true });
  });

  it("doesn't when the server sends no email", async () => {
    const u = await newUser(off.app, 'verify-off');
    const res = await req(off.app, 'GET', apiPaths.auth.me, u.token);
    expect(res.json()).toMatchObject({ user: { emailVerified: false }, emailVerification: false });
  });
});
