import { expect, test, type Page } from '@playwright/test';

/** F02 journey: register → 4-step wizard (with resume) → business home; tenant isolation in the UI. */
const PASSWORD = 'Sup3r-secret-pass!';
const uniqueEmail = (tag: string) =>
  `f02-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

async function register(page: Page, email: string, fullName: string) {
  await page.goto('/register');
  await page.getByLabel('שם מלא').fill(fullName);
  await page.getByLabel('אימייל').fill(email);
  await page.getByRole('textbox', { name: 'סיסמה', exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

test('owner completes onboarding (resuming after a reload) and reaches the business home; another user cannot open it', async ({
  page,
  browser,
}) => {
  await register(page, uniqueEmail('owner'), 'שירן לוי');

  // Step 1
  await expect(page.getByText('שלב 1 מתוך 4')).toBeVisible();
  await page.getByLabel(/שם העסק/).fill('מספרת שירן');
  await page.getByLabel(/תחום פעילות/).selectOption('beauty');
  await page.getByRole('button', { name: 'המשך' }).click();

  // Step 2
  await expect(page.getByText('שלב 2 מתוך 4')).toBeVisible();
  await page.getByLabel(/טלפון העסק/).fill('050-1234567');
  await page.getByLabel('כתובת', { exact: true }).fill('הרצל 10, חיפה');
  await page.getByRole('button', { name: 'המשך' }).click();
  await expect(page.getByText('שלב 3 מתוך 4')).toBeVisible();

  // Leave and come back: the wizard resumes at step 3 (AC-01).
  const wizardUrl = page.url();
  await page.goto('/');
  await expect(page).toHaveURL(wizardUrl);
  await expect(page.getByText('שלב 3 מתוך 4')).toBeVisible();

  // Step 3
  await page.getByLabel('הוספת אזור שירות').fill('חיפה');
  await page.keyboard.press('Enter');
  await page.getByLabel('הוספת אזור שירות').fill('יקנעם');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'המשך' }).click();

  // Step 4 → finish
  await expect(page.getByText('שלב 4 מתוך 4')).toBeVisible();
  await page.getByRole('button', { name: 'סיום והמשך למערכת' }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'שלום, שירן' })).toBeVisible();
  await expect(page.getByText('050-1234567')).toBeVisible();
  await expect(page.getByText('חיפה, יקנעם')).toBeVisible();
  const homeUrl = page.url();

  // Another tenant opens the same URL → "not found" (AC-05).
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await register(otherPage, uniqueEmail('other'), 'אבי כהן');
  await otherPage.goto(homeUrl);
  await expect(otherPage.getByRole('heading', { name: 'העסק לא נמצא' })).toBeVisible();
  await expect(otherPage.getByText('מספרת שירן')).toHaveCount(0);
  await other.close();
});
