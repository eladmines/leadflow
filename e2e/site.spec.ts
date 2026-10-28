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
/** The editor preview has re-rendered with the latest draft (it reloads after each edit). */
const previewReady = (page: Page) =>
  expect(page.locator('iframe[title="תצוגה מקדימה של האתר"][data-ready="true"]')).toBeVisible();

test('owner builds the site: template → edit → autosave → reload', async ({ page, isMobile }) => {
  const id = await ownerWithActiveBusiness(page);
  await page.goto(`/b/${id}/site`);

  await expect(page.getByText('מומלץ לעסק שלך')).toBeVisible();
  await page.getByRole('button', { name: 'בחירת התבנית' }).first().click();
  await expect(page.getByRole('heading', { name: 'האתר שלי' })).toBeVisible();
  await expect(preview(page).getByRole('heading', { level: 1 })).toHaveText('מספרת שירן');

  let saved = nextSave(page);
  if (isMobile) {
    // Phones edit through the panel.
    await page.getByRole('button', { name: /^כותרת ראשית/ }).click();
    await page.getByLabel('כותרת', { exact: true }).fill('שירן — עיצוב שיער');
  } else {
    // Desktop types on the page.
    const h1 = preview(page).locator('h1[data-edit]');
    await h1.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('שירן — עיצוב שיער');
    await page.keyboard.press('Enter');
  }
  await saved;
  await expect(page.getByText('כל השינויים נשמרו')).toBeVisible({ timeout: 10_000 });
  await expect(preview(page).getByRole('heading', { level: 1 })).toHaveText('שירן — עיצוב שיער');

  if (isMobile) await page.getByRole('button', { name: 'כל המקטעים' }).click();
  else await page.getByRole('button', { name: 'מקטעים, עיצוב וגוגל' }).click();
  saved = nextSave(page);
  await page.getByRole('button', { name: 'הסתרת המלצות' }).click();
  await saved;

  await page.reload();
  await expect(preview(page).getByRole('heading', { level: 1 })).toHaveText('שירן — עיצוב שיער');
  await expect(preview(page).getByText('מה הלקוחות מספרים')).toHaveCount(0);
  if (!isMobile) await page.getByRole('button', { name: 'מקטעים, עיצוב וגוגל' }).click();
  await expect(page.getByRole('button', { name: 'הצגת המלצות' })).toBeVisible();

  if (isMobile) {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  }
});

test('desktop editing happens on the page: sections, list items and settings', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'hover tools are for mouse users; touch users use the panel');
  const id = await ownerWithActiveBusiness(page);
  await page.goto(`/b/${id}/site`);
  await page.getByRole('button', { name: 'בחירת התבנית' }).first().click();
  const frame = preview(page);
  await expect(frame.getByRole('heading', { level: 1 })).toHaveText('מספרת שירן');
  // The settings panel starts closed: the page gets the full width.
  await expect(page.getByRole('complementary', { name: 'הגדרות האתר' })).toBeHidden();

  // Hover → toolbar; move "מחירון" above "שירותים".
  await frame.locator('#s-pricing').hover();
  let saved = nextSave(page);
  await page.getByRole('toolbar').getByRole('button', { name: 'הזזת מחירון למעלה' }).click();
  await saved;
  await expect(frame.locator('main > [id^="s-"]').nth(1)).toHaveId('s-pricing');
  await previewReady(page);

  // Add a service on the page; typing starts in its name right away.
  const cards = frame.locator('#s-services article');
  await expect(cards).toHaveCount(3);
  saved = nextSave(page);
  await frame.locator('#s-services .ed-add').click();
  await saved;
  await expect(cards).toHaveCount(4);
  await expect(frame.locator('[contenteditable]')).toHaveAttribute(
    'data-edit',
    'services:items.3.name',
  );
  saved = nextSave(page);
  await page.keyboard.type('החלקת שיער');
  await page.keyboard.press('Enter');
  await saved;
  await expect(cards.nth(3).locator('h3')).toHaveText('החלקת שיער');
  await previewReady(page);

  // Delete the first service from its card.
  await cards.first().hover();
  saved = nextSave(page);
  await cards.first().locator('[data-act="del"]').click();
  await saved;
  await expect(cards).toHaveCount(3);
  await previewReady(page);

  // "+" under a section inserts a new one right after it.
  await frame.locator('#s-hero').hover();
  await page.getByRole('button', { name: 'הוספת מקטע כאן' }).click();
  saved = nextSave(page);
  await page
    .getByRole('list', { name: 'סוג המקטע להוספה' })
    .getByRole('button', { name: 'שאלות נפוצות' })
    .click();
  await saved;
  await expect(frame.locator('main > [id^="s-"]').nth(1).locator('.faq')).toBeVisible();

  // Section settings open in the panel (only settings; texts are on the page).
  await frame.locator('#s-contact').hover();
  await page.getByRole('toolbar').getByRole('button', { name: 'הגדרות יצירת קשר' }).click();
  await expect(page.getByRole('checkbox', { name: 'הצגת טלפון' })).toBeVisible();
  await expect(page.getByLabel('כותרת', { exact: true })).toBeHidden();

  // Links in the preview don't navigate away from the editor.
  await frame.locator('#s-contact a[href^="tel:"]').first().click();
  await expect(page).toHaveURL(new RegExp(`/b/${id}/site$`));
});
