import { expect, test, type Page } from '@playwright/test';
import { choose } from './choose';

/** The lead's history (and facts): the "מידע" tab (D-220). Opens it if another tab is open. */
async function openLeadHistory(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const info = page.getByRole('tab', { name: 'מידע' });
  if ((await info.getAttribute('aria-selected')) !== 'true') await info.click();
}

/** F08: manual lead → board (drag or stage menu) → lead page (stage, note, history) → search. */
const PASSWORD = 'Sup3r-secret-pass!';
const API_HEADERS = { 'X-Requested-With': 'SimpleCatch', Origin: 'http://localhost:5173' };

async function ownerWithBusiness(page: Page) {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto('/register');
  await page.getByLabel('שם מלא').fill('שירן לוי');
  await page.getByLabel('אימייל').fill(`f08-${tag}@example.com`);
  await page.getByRole('textbox', { name: 'סיסמה', exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const { business } = await (
    await page.request.post('/api/v1/businesses', {
      headers: API_HEADERS,
      data: { name: 'מוסך הצפון', industry: 'garage' },
    })
  ).json();
  await page.request.patch(`/api/v1/businesses/${business.id}`, {
    headers: API_HEADERS,
    data: { phone: '04-8123456' },
  });
  await page.request.post(`/api/v1/businesses/${business.id}/onboarding/complete`, {
    headers: API_HEADERS,
  });
  return business.id as string;
}

test('owner works a lead through the pipeline', async ({ page, isMobile }) => {
  const id = await ownerWithBusiness(page);
  await page.goto(`/b/${id}/leads`);
  await expect(page.getByRole('heading', { name: 'עדיין אין פניות' })).toBeVisible();

  // Manual lead.
  await page.getByRole('button', { name: 'ליד חדש' }).click();
  const dialog = page.getByRole('dialog', { name: 'ליד חדש' });
  await dialog.getByLabel(/^שם/).fill('אבי כהן');
  await dialog.getByLabel('טלפון').fill('054-1112233');
  await dialog.getByLabel('פרטי הפנייה').fill('טיפול 10,000 ק"מ ליונדאי i20');
  await dialog.getByRole('button', { name: 'יצירת ליד' }).click();
  await expect(page.getByRole('heading', { name: 'אבי כהן', level: 1 })).toBeVisible();
  // The full history is in "מידע" (D-220).
  await openLeadHistory(page);
  await expect(page.getByText('הליד נוצר ידנית')).toBeVisible();

  // Board: move to "נוצר קשר" — drag on desktop, stage menu on mobile.
  await page.getByRole('link', { name: 'כל הלידים' }).click();
  const board = page.getByRole('list', { name: 'לוח לידים' });
  const card = board.getByRole('article').filter({ hasText: 'אבי כהן' });
  const target = board.getByRole('listitem', { name: /^נוצר קשר/ });
  if (isMobile) {
    await choose(page, card.getByLabel('העברת אבי כהן לשלב'), 'נוצר קשר');
  } else {
    await card.dragTo(target);
  }
  await expect(target.getByRole('link', { name: 'אבי כהן' })).toBeVisible();
  await expect(board.getByRole('listitem', { name: 'נוצר קשר: 1 לידים' })).toBeVisible();

  // Lead page: stage change, note, history.
  await target.getByRole('link', { name: 'אבי כהן' }).click();
  await expect(page.getByLabel('שלב', { exact: true })).toContainText(/.+/);
  await choose(page, page.getByLabel('שלב', { exact: true }), 'ממתין');
  await openLeadHistory(page);
  await expect(page.getByText('השלב שונה מ"נוצר קשר" ל"ממתין"')).toBeVisible();
  // D-219: no notes yet, so the notes tab is opened from the "+" menu.
  await page.getByRole('button', { name: 'הוספה לליד' }).click();
  await page.getByRole('menuitem', { name: 'הערה' }).click();
  await page.getByLabel('הוספת הערה').fill('נשלחה הצעה של ₪650, מחכה לאישור');
  await page.getByRole('button', { name: 'שמירת הערה' }).click();
  const history = page.getByRole('list', { name: 'היסטוריית הליד' });
  // D-218: notes live in the notes tab; the history holds system events.
  await expect(
    page.getByRole('list', { name: 'הערות' }).getByText('נשלחה הצעה של ₪650, מחכה לאישור'),
  ).toBeVisible();
  await expect(history.getByText('השלב שונה מ"חדש" ל"נוצר קשר"')).toBeVisible();

  // Search by phone in local format.
  await page.goto(`/b/${id}/leads?view=list`);
  await page.getByLabel('חיפוש לידים').fill('0541112233');
  await expect(page).toHaveURL(/q=0541112233/);
  await expect(page.getByRole('list', { name: 'פניות' }).getByRole('article')).toHaveCount(1);
  await page.getByLabel('חיפוש לידים').fill('אין כזה');
  await expect(page.getByText('לא נמצאו לידים שמתאימים לחיפוש.')).toBeVisible();

  // Export what's on screen to Excel (CSV with BOM).
  await page.getByLabel('חיפוש לידים').fill('');
  await expect(page).not.toHaveURL(/q=/); // the search is debounced into the URL
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'עוד' }).click();
  await page.getByRole('link', { name: 'ייצוא לאקסל' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^simplecatch-leads-\d{4}-\d{2}-\d{2}\.csv$/);
  const { readFile } = await import('node:fs/promises');
  const csv = await readFile((await file.path())!, 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('אבי כהן,054-1112233');
});
