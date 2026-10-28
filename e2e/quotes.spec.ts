import { expect, test, type Page } from '@playwright/test';

/** F18: quote from a lead → totals → send → customer accepts on the private page → lead history. */
const PASSWORD = 'Sup3r-secret-pass!';
const API_HEADERS = { 'X-Requested-With': 'LeadFlow', Origin: 'http://localhost:5173' };

async function ownerWithLead(page: Page) {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto('/register');
  await page.getByLabel('שם מלא').fill('אבי כהן');
  await page.getByLabel('אימייל').fill(`f18-${tag}@example.com`);
  await page.getByRole('textbox', { name: 'סיסמה', exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const api = (url: string, data?: object, method: 'post' | 'patch' = 'post') =>
    page.request[method](url, { headers: API_HEADERS, data });
  const { business } = await (
    await api('/api/v1/businesses', { name: 'שיפוצי הצפון', industry: 'trades' })
  ).json();
  await api(`/api/v1/businesses/${business.id}`, { phone: '04-8123456' }, 'patch');
  await api(`/api/v1/businesses/${business.id}/onboarding/complete`);
  const { lead } = await (
    await api(`/api/v1/businesses/${business.id}/leads`, { name: 'רון לוי', phone: '052-1112233' })
  ).json();
  return { id: business.id as string, leadId: lead.id as string };
}

test('quote from a lead, sent, accepted by the customer', async ({ page, browser }) => {
  const { id, leadId } = await ownerWithLead(page);
  await page.goto(`/b/${id}/leads/${leadId}`);
  await page.getByRole('link', { name: 'הצעת מחיר חדשה' }).click();
  await expect(page.getByRole('heading', { name: 'הצעת מחיר חדשה' })).toBeVisible();

  await page.getByLabel('תיאור שורה 1').fill('החלפת ברז');
  await page.getByLabel('מחיר יחידה שורה 1').fill('350');
  await page.getByRole('button', { name: 'הוספת שורה' }).click();
  await page.getByLabel('תיאור שורה 2').fill('נקודת מים');
  await page.getByLabel('כמות שורה 2').fill('2');
  await page.getByLabel('מחיר יחידה שורה 2').fill('200.50');
  // 350 + 401 = 751; VAT 18% = 135.18 → 886.18
  await expect(page.getByLabel('סיכום')).toContainText('886.18');
  await page.getByRole('button', { name: 'שמירה כטיוטה' }).click();
  await expect(page.getByRole('heading', { name: 'הצעת מחיר מס׳ 1001' })).toBeVisible();

  await page.getByRole('button', { name: 'שליחה ללקוח' }).click();
  const dialog = page.getByRole('dialog', { name: 'שליחת ההצעה ללקוח' });
  await dialog.getByRole('button', { name: 'שליחה', exact: true }).click();
  await expect(dialog.getByRole('link', { name: /WhatsApp/ })).toBeVisible();
  await page.keyboard.press('Escape');
  const link = await page.getByRole('link', { name: 'פתיחת עמוד ההצעה' }).getAttribute('href');
  expect(link).toMatch(/\/q\/[A-Za-z0-9_-]{43}$/);

  // The customer, with no login.
  const customer = await (await browser.newContext()).newPage();
  await customer.goto(link!);
  await expect(customer.getByRole('heading', { name: 'הצעת מחיר מס׳ 1001' })).toBeVisible();
  await expect(customer.getByText('886.18').first()).toBeVisible();
  await customer.getByRole('button', { name: 'אישור ההצעה' }).click();
  await customer.getByRole('button', { name: 'כן, מאשר/ת' }).click();
  await expect(customer.getByText(/ההצעה אושרה/)).toBeVisible();

  await page.goto(`/b/${id}/leads/${leadId}`);
  await expect(page.getByText('הצעת מחיר מס׳ 1001 אושרה על ידי הלקוח')).toBeVisible();
});
