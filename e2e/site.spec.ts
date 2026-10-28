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

test('owner edits on the page itself: select, move and insert sections from the preview', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'hover tools are for mouse users; touch users use the section list');
  const id = await ownerWithActiveBusiness(page);
  await page.goto(`/b/${id}/site`);
  await page.getByRole('button', { name: 'בחירת התבנית' }).first().click();
  const frame = preview(page);
  await expect(frame.getByRole('heading', { level: 1 })).toHaveText('מספרת שירן');
  const sectionList = () =>
    page.getByRole('list', { name: 'מקטעי האתר' }).getByRole('listitem').allInnerTexts();

  // Hover → toolbar; move "מחירון" above "שירותים".
  await frame.locator('#s-pricing').hover();
  let saved = nextSave(page);
  await page.getByRole('toolbar').getByRole('button', { name: 'הזזת מחירון למעלה' }).click();
  await saved;
  expect((await sectionList())[1]).toContain('מחירון');

  // Click a section on the page → its form opens.
  await frame.locator('#s-about').click({ position: { x: 40, y: 40 } });
  await expect(page.getByRole('heading', { name: 'אודות', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'כל המקטעים' }).click();

  // "+" under a section inserts the new one right after it and opens it.
  await frame.locator('#s-hero').hover();
  await page.getByRole('button', { name: 'הוספת מקטע כאן' }).click();
  saved = nextSave(page);
  await page
    .getByRole('list', { name: 'סוג המקטע להוספה' })
    .getByRole('button', { name: 'שאלות נפוצות' })
    .click();
  await saved;
  await expect(page.getByRole('heading', { name: 'שאלות נפוצות', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'כל המקטעים' }).click();
  expect((await sectionList())[1]).toContain('שאלות נפוצות');

  // Links in the preview don't navigate away from the editor.
  await frame.locator('#s-contact a[href^="tel:"]').first().click();
  await expect(page).toHaveURL(new RegExp(`/b/${id}/site$`));
});

test('owner types directly on the page; the text is saved and survives a reload', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'typing on the page is tested with a mouse and keyboard');
  const id = await ownerWithActiveBusiness(page);
  await page.goto(`/b/${id}/site`);
  await page.getByRole('button', { name: 'בחירת התבנית' }).first().click();
  const frame = preview(page);
  const h1 = frame.locator('h1[data-edit]');
  await expect(h1).toHaveText('מספרת שירן');

  await h1.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' בחיפה');
  const saved = nextSave(page);
  await page.keyboard.press('Enter');
  await saved;
  await expect(page.getByLabel('כותרת', { exact: true })).toHaveValue('מספרת שירן בחיפה');

  await page.reload();
  await expect(preview(page).getByRole('heading', { level: 1 })).toHaveText('מספרת שירן בחיפה');
});
