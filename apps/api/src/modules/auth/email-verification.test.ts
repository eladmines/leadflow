import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiPaths } from '@leadflow/shared';
import { createTestApp, testConfig } from '../../../test/helpers';
import { newUser, req } from '../../../test/business-helpers';

/** D-122: no email going out → the app is told not to ask for verification. */
describe('email verification follows the email setting', () => {
  let on: Awaited<ReturnType<typeof createTestApp>>;
  let off: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    on = await createTestApp();
    off = await createTestApp({ config: testConfig({ EMAIL_TRANSPORT: 'disabled' }) });
  });
  afterAll(async () => {
    await on.close();
    await off.close();
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
