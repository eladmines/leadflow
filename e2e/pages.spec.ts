import { expect, test, type Page } from '@playwright/test';

/** D-081: add a page in the editor → publish → it's live at its own address and in the menu. */
const PASSWORD = 'Sup3r-secret-pass!';
const API_HEADERS = { 'X-Requested-With': 'LeadFlow', Origin: 'http://localhost:5173' };

async function owner(page: Page) {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto('/register');
  await page.getByLabel('שם מלא').fill('שירן לוי');
  await page.getByLabel('אימייל').fill(`pages-${tag}@example.com`);
  await page.getByRole('textbox', { name: 'סיסמה', exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const api = (url: string, data?: object, method: 'post' | 'patch' = 'post') =>
    page.request[method](url, { headers: API_HEADERS, data });
  const { business } = await (
    await api('/api/v1/businesses', { name: 'מספרת שירן', industry: 'beauty' })
  ).json();
  await api(`/api/v1/businesses/${business.id}`, { phone: '050-1234567' }, 'patch');
  await api(`/api/v1/businesses/${business.id}/onboarding/complete`);
  return { id: business.id as string, subdomain: `pages-${tag}` };
}

test('add an "about" page, publish, and open it on the live site', async ({ page, context }) => {
  const { id, subdomain } = await owner(page);
  await page.goto(`/b/${id}/site`);
  await page.getByRole('button', { name: 'בחירת התבנית' }).first().click();
  const preview = page.frameLocator('iframe[title="תצוגה מקדימה של האתר"]');
  await expect(preview.getByRole('heading', { level: 1 })).toHaveText('מספרת שירן');

  await page.getByRole('button', { name: 'עמוד חדש' }).click();
  const add = page.getByRole('dialog', { name: 'עמוד חדש' });
  await add.getByLabel('תוכן התחלתי (לא חובה)').selectOption('about');
  await add.getByRole('button', { name: 'הוספת העמוד' }).click();
  await expect(page.getByRole('tab', { name: 'אודות' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('כל השינויים נשמרו')).toBeVisible({ timeout: 10_000 });

  // Publish through the dialog (choosing the address first).
  await page.getByRole('button', { name: 'פרסום האתר' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('כתובת האתר').fill(subdomain);
  await dialog.getByRole('button', { name: 'שמירת הכתובת והמשך' }).click();
  await dialog.getByRole('button', { name: 'פרסום האתר' }).click();
  await expect(page.getByRole('dialog', { name: 'האתר באוויר!' })).toBeVisible();

  // The live home page links to the new page (footer links work on every screen size).
  const visitor = await context.newPage();
  await visitor.goto(`http://${subdomain}.lvh.me:4100/`);
  await visitor.locator('footer').getByRole('link', { name: 'אודות' }).click();
  await expect(visitor).toHaveURL(/\/about$/);
  await expect(visitor).toHaveTitle(/^אודות · מספרת שירן/);
  await expect(visitor.locator('.menu a[href="/about"]')).toHaveAttribute('aria-current', 'page');
});
