import { expect, test, type Page } from '@playwright/test';

/** F09: owner invites → email link → new user registers and joins → sees only assigned leads. */
const PASSWORD = 'Sup3r-secret-pass!';
const MAILPIT = 'http://localhost:8025/api/v1';
const API_HEADERS = { 'X-Requested-With': 'LeadFlow', Origin: 'http://localhost:5173' };
const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function register(page: Page, email: string, name: string) {
  await page.goto('/register');
  await page.getByLabel('שם מלא').fill(name);
  await page.getByLabel('אימייל').fill(email);
  await page.getByRole('textbox', { name: 'סיסמה', exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();
}

async function inviteLink(page: Page, to: string) {
  let link = '';
  await expect
    .poll(
      async () => {
        const { messages } = (await (
          await page.request.get(`${MAILPIT}/search?query=${encodeURIComponent(`to:${to}`)}`)
        ).json()) as { messages: { ID: string; Subject: string }[] };
        const hit = messages.find((m) => m.Subject.startsWith('הוזמנת להצטרף'));
        if (!hit) return '';
        const msg = (await (await page.request.get(`${MAILPIT}/message/${hit.ID}`)).json()) as {
          Text: string;
        };
        link = /https?:\/\/\S+\/invite\?token=[A-Za-z0-9_-]{43}/.exec(msg.Text)?.[0] ?? '';
        return link;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();
  return new URL(link).pathname + new URL(link).search;
}

test('owner invites an employee who registers from the email and joins with limited access', async ({
  page,
  browser,
}) => {
  const t = tag();
  await register(page, `owner-${t}@example.com`, 'שירן לוי');
  await expect(page).toHaveURL(/\/onboarding$/);
  const { business } = await (
    await page.request.post('/api/v1/businesses', {
      headers: API_HEADERS,
      data: { name: 'מספרת שירן', industry: 'beauty' },
    })
  ).json();
  await page.request.patch(`/api/v1/businesses/${business.id}`, {
    headers: API_HEADERS,
    data: { phone: '050-1234567' },
  });
  await page.request.post(`/api/v1/businesses/${business.id}/onboarding/complete`, {
    headers: API_HEADERS,
  });
  const leadRes = await page.request.post(`/api/v1/businesses/${business.id}/leads`, {
    headers: API_HEADERS,
    data: { name: 'מיכל אברהם', phone: '050-7771111' },
  });
  const { lead } = await leadRes.json();

  // Owner invites from the Team page.
  const empEmail = `emp-${t}@example.com`;
  await page.goto(`/b/${business.id}/team`);
  await page.getByLabel('אימייל', { exact: true }).fill(empEmail);
  await page.getByRole('button', { name: 'שליחת הזמנה' }).click();
  await expect(page.getByText(/ההזמנה נשלחה אל/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'הזמנות ממתינות' })).toContainText(empEmail);

  // The invitee opens the link in a fresh browser, registers, and joins.
  const other = await browser.newContext();
  const emp = await other.newPage();
  await emp.goto(await inviteLink(page, empEmail));
  await expect(emp.getByRole('heading', { name: 'הוזמנת להצטרף למספרת שירן' })).toBeVisible();
  await emp.getByRole('link', { name: 'יצירת חשבון והצטרפות' }).click();
  await expect(emp.getByLabel('אימייל')).toHaveValue(empEmail);
  await emp.getByLabel('שם מלא').fill('יוסי מזרחי');
  await emp.getByRole('textbox', { name: 'סיסמה', exact: true }).fill(PASSWORD);
  await emp.getByRole('checkbox').check();
  await emp.getByRole('button', { name: 'יצירת חשבון' }).click();
  await expect(emp).toHaveURL(/\/invite/); // back to the invitation, not the setup wizard
  await emp.getByRole('button', { name: 'הצטרפות לצוות' }).click();
  await expect(emp).toHaveURL(new RegExp(`/b/${business.id}$`));
  await expect(emp.getByText('מספרת שירן · עובד/ת')).toBeVisible();
  await expect(emp.getByRole('heading', { name: 'כדאי לאמת את כתובת האימייל' })).toHaveCount(0); // verified by the link

  // Employee sees no leads until one is assigned.
  await emp.goto(`/b/${business.id}/leads?view=list`);
  await expect(emp.getByText('כשיוקצו לך פניות, הן יופיעו כאן.')).toBeVisible();

  // Owner sees the new member and assigns the lead.
  await page.reload();
  await expect(page.getByRole('list', { name: 'חברי הצוות' })).toContainText('יוסי מזרחי');
  await page.goto(`/b/${business.id}/leads/${lead.id}`);
  await page.getByLabel('אחראי', { exact: true }).selectOption({ label: 'יוסי מזרחי' });
  await expect(page.getByText('הליד שויך ליוסי מזרחי')).toBeVisible();

  await emp.reload();
  await expect(emp.getByRole('list', { name: 'פניות' }).getByRole('article')).toHaveCount(1);
  await expect(emp.getByText('מיכל אברהם')).toBeVisible();
  await other.close();
});
