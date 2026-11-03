import { expect, test, type Page } from '@playwright/test';

/** D-093: the product tour opens once on first entry, can be skipped, and replays from the menu. */
const PASSWORD = 'Sup3r-secret-pass!';

// This spec covers the tour itself, so start without the "tour off" flag the config sets.
test.use({
  storageState: {
    cookies: [],
    origins: [
      { origin: 'http://localhost:5173', localStorage: [{ name: 'leadflow.locale', value: 'he' }] },
    ],
  },
});

async function ownerWithBusiness(page: Page) {
  await page.goto('/register');
  await page.getByLabel('שם מלא').fill('סיגלית לוי');
  await page
    .getByLabel('אימייל')
    .fill(`tour-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`);
  await page.getByRole('textbox', { name: 'סיסמה', exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();
  await expect(page.getByText('שלב 1 מתוך 4')).toBeVisible();
  await page.getByLabel(/שם העסק/).fill('עיצוב שיער סיגלית');
  await page.getByLabel(/תחום פעילות/).selectOption('beauty');
  await page.getByRole('button', { name: 'המשך' }).click();
  await expect(page.getByText('שלב 2 מתוך 4')).toBeVisible();
  await page.getByLabel(/טלפון העסק/).fill('050-1234567');
  await page.getByRole('button', { name: 'המשך' }).click();
  await expect(page.getByText('שלב 3 מתוך 4')).toBeVisible();
  await page.getByRole('button', { name: 'המשך' }).click();
  await expect(page.getByText('שלב 4 מתוך 4')).toBeVisible();
  await page.getByRole('button', { name: 'סיום והמשך למערכת' }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}$/);
}

test('the tour walks through the menu once and replays from the sidebar', async ({
  page,
  isMobile,
}) => {
  await ownerWithBusiness(page);
  const tour = page.getByRole('dialog');
  await expect(tour.getByRole('heading', { name: 'ברוכים הבאים ל-LeadFlow' })).toBeVisible();
  await expect(tour.getByText('1 מתוך')).toBeVisible();

  if (isMobile) {
    // Phones: centred cards; skipping closes it for good.
    await tour.getByRole('button', { name: 'דילוג' }).click();
    await expect(tour).toBeHidden();
    await page.reload();
    await expect(
      page.getByRole('heading', { name: /(בוקר טוב|צהריים טובים|ערב טוב), סיגלית/ }),
    ).toBeVisible();
    await expect(page.getByRole('dialog')).toBeHidden();
    return;
  }

  await tour.getByRole('button', { name: 'יאללה, מתחילים' }).click();
  await expect(tour.getByRole('heading', { name: 'דשבורד' })).toBeVisible();
  // Keyboard: in RTL the left arrow moves forward.
  await page.keyboard.press('ArrowLeft');
  await expect(tour.getByRole('heading', { name: 'האתר שלי' })).toBeVisible();
  // Walk to the end.
  while (await tour.getByRole('button', { name: 'הבא' }).isVisible()) {
    await tour.getByRole('button', { name: 'הבא' }).click();
  }
  await expect(tour.getByRole('heading', { name: 'זהו, אפשר להתחיל!' })).toBeVisible();
  await tour.getByRole('button', { name: 'סיום' }).click();
  await expect(tour).toBeHidden();

  // Seen: not shown again on the next visit, but available from the menu.
  await page.reload();
  await expect(
    page.getByRole('heading', { name: /(בוקר טוב|צהריים טובים|ערב טוב), סיגלית/ }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'סיור במערכת' }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'ברוכים הבאים ל-LeadFlow' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});
