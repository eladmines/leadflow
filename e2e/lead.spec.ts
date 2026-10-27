import { expect, test, type Page } from '@playwright/test';

/**
 * Core journey (F01→F07): register → business → site → publish → a visitor leaves details on
 * the live site → the owner sees the lead in LeadFlow and gets an email (AC-04).
 */
const PASSWORD = 'Sup3r-secret-pass!';
const MAILPIT = 'http://localhost:8025/api/v1';
const API_HEADERS = { 'X-Requested-With': 'LeadFlow', Origin: 'http://localhost:5173' };

async function ownerWithLiveSite(page: Page) {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `f07-${tag}@example.com`;
  await page.goto('/register');
  await page.getByLabel('שם מלא').fill('שירן לוי');
  await page.getByLabel('אימייל').fill(email);
  await page.getByRole('textbox', { name: 'סיסמה', exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  const api = (method: 'post' | 'patch' | 'put', url: string, data?: object) =>
    page.request[method](url, { headers: API_HEADERS, data });
  const { business } = await (
    await api('post', '/api/v1/businesses', { name: 'מספרת שירן', industry: 'beauty' })
  ).json();
  await api('patch', `/api/v1/businesses/${business.id}`, { phone: '050-1234567' });
  await api('post', `/api/v1/businesses/${business.id}/onboarding/complete`);
  await api('post', `/api/v1/businesses/${business.id}/site`, { templateKey: 'beauty' });
  const subdomain = `lead-${tag}`;
  await api('put', `/api/v1/businesses/${business.id}/site/subdomain`, { subdomain });
  await api('post', `/api/v1/businesses/${business.id}/site/publish`, { revision: 0 });
  return { id: business.id as string, email, liveUrl: `http://${subdomain}.lvh.me:4100/` };
}

test('a visitor submits the website form and the owner sees the lead (AC-04)', async ({
  page,
  context,
}) => {
  const owner = await ownerWithLiveSite(page);

  // The visitor fills the form on the live site.
  const visitor = await context.newPage();
  await visitor.goto(owner.liveUrl);
  const form = visitor.getByRole('form', { name: 'טופס יצירת קשר' });
  await form.getByLabel('שם מלא').fill('דנה כהן');
  await form.getByLabel('טלפון').fill('052-7654321');
  await form.getByLabel(/אימייל/).fill('dana@example.com');
  await form.getByLabel(/איך נוכל לעזור/).fill('אשמח לתור ליום חמישי אחר הצהריים');
  await form.getByRole('checkbox').check();
  await visitor.waitForTimeout(3200); // humans take a moment; the server drops instant submits
  await form.getByRole('button', { name: 'שליחה' }).click();
  await expect(visitor.getByRole('heading', { name: 'תודה!' })).toBeVisible();
  await expect(visitor.getByText('קיבלנו את הפרטים')).toBeVisible();

  // The owner sees it in LeadFlow.
  await page.goto(`/b/${owner.id}/leads?view=list`);
  const card = page.getByRole('list', { name: 'פניות' }).getByRole('article').first();
  await expect(card.getByRole('heading', { name: 'דנה כהן' })).toBeVisible();
  await expect(card.getByText('אשמח לתור ליום חמישי אחר הצהריים')).toBeVisible();
  await expect(card.getByText(/טופס באתר/)).toBeVisible();
  await expect(card.getByText('חדש', { exact: true })).toBeVisible();
  await expect(card.getByRole('link', { name: /052-7654321/ })).toHaveAttribute(
    'href',
    'tel:+972527654321',
  );

  await page.goto(`/b/${owner.id}`);
  await expect(page.getByRole('list', { name: 'פניות אחרונות' })).toContainText('דנה כהן');

  // …and got an email.
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `${MAILPIT}/search?query=${encodeURIComponent(`to:${owner.email}`)}`,
        );
        const { messages } = (await res.json()) as { messages: { Subject: string }[] };
        return messages.map((m) => m.Subject);
      },
      { timeout: 15_000 },
    )
    .toContain('פנייה חדשה מהאתר — מספרת שירן');
});

test('browser validation stops an incomplete form; nothing is sent', async ({ page, context }) => {
  const owner = await ownerWithLiveSite(page);
  const visitor = await context.newPage();
  await visitor.goto(owner.liveUrl);
  const form = visitor.getByRole('form', { name: 'טופס יצירת קשר' });
  await form.getByLabel('שם מלא').fill('דנה');
  await form.getByRole('button', { name: 'שליחה' }).click();
  // Still on the site (required phone + consent blocked the submit).
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('מספרת שירן');
  await page.goto(`/b/${owner.id}/leads`);
  await expect(page.getByRole('heading', { name: 'עדיין אין פניות' })).toBeVisible();
});
