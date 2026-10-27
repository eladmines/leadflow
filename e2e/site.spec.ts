import { expect, test, type Page } from '@playwright/test';

/** F04: pick a template → edit → autosave → reload keeps the draft; preview reflects edits. */
const PASSWORD = 'Sup3r-secret-pass!';
const API_HEADERS = { 'X-Requested-With': 'LeadFlow', Origin: 'http://localhost:5173' };

async function ownerWithActiveBusiness(page: Page) {
  const email = `f04-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  await page.goto('/register');
  await page.getByLabel('שם מלא').fill('שירן לוי');
  await page.getByLabel('אימייל').fill(email);
  await page.getByRole('textbox', { name: 'סיסמה', exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const created = await page.request.post('/api/v1/businesses', {
    headers: API_HEADERS,
    data: { name: 'מספרת שירן', industry: 'beauty' },
  });
  const { business } = (await created.json()) as { business: { id: string } };
  await page.request.patch(`/api/v1/businesses/${business.id}`, {
    headers: API_HEADERS,
    data: { phone: '050-1234567' },
  });
  await page.request.post(`/api/v1/businesses/${business.id}/onboarding/complete`, {
    headers: API_HEADERS,
  });
  return business.id;
}

/** Resolves when the editor's next draft save completes. */
const nextSave = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().includes('/site/draft') && r.request().method() === 'PUT' && r.ok(),
  );

const preview = (page: Page) => page.frameLocator('iframe[title="תצוגה מקדימה של האתר"]');

test('owner builds the site: template → edit → autosave → reload', async ({ page, isMobile }) => {
  const id = await ownerWithActiveBusiness(page);
  await page.goto(`/b/${id}/site`);

  await expect(page.getByText('מומלץ לעסק שלך')).toBeVisible();
  await page.getByRole('button', { name: 'בחירת התבנית' }).first().click();
  await expect(page.getByRole('heading', { name: 'האתר שלי' })).toBeVisible();
  await expect(preview(page).getByRole('heading', { level: 1 })).toHaveText('מספרת שירן');

  await page.getByRole('button', { name: /^כותרת ראשית/ }).click();
  let saved = nextSave(page);
  await page.getByLabel('כותרת', { exact: true }).fill('שירן — עיצוב שיער');
  await saved;
  await expect(page.getByText('כל השינויים נשמרו')).toBeVisible({ timeout: 10_000 });
  await expect(preview(page).getByRole('heading', { level: 1 })).toHaveText('שירן — עיצוב שיער');

  await page.getByRole('button', { name: 'כל המקטעים' }).click();
  saved = nextSave(page);
  await page.getByRole('button', { name: 'הסתרת המלצות' }).click();
  await saved;

  await page.reload();
  await expect(preview(page).getByRole('heading', { level: 1 })).toHaveText('שירן — עיצוב שיער');
  await expect(preview(page).getByText('מה הלקוחות מספרים')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'הצגת המלצות' })).toBeVisible();

  if (isMobile) {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  }
});
