import { expect, test, type Page } from '@playwright/test';

/** F08: manual lead → board (drag or stage menu) → lead page (stage, note, history) → search. */
const PASSWORD = 'Sup3r-secret-pass!';
const API_HEADERS = { 'X-Requested-With': 'LeadFlow', Origin: 'http://localhost:5173' };

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
  await expect(page.getByText('הליד נוצר ידנית')).toBeVisible();

  // Board: move to "נוצר קשר" — drag on desktop, stage menu on mobile.
  await page.getByRole('link', { name: 'כל הלידים' }).click();
  const board = page.getByRole('list', { name: 'לוח לידים' });
  const card = board.getByRole('article').filter({ hasText: 'אבי כהן' });
  const target = board.getByRole('listitem', { name: /^נוצר קשר/ });
  if (isMobile) {
    await card.getByLabel('העברת אבי כהן לשלב').selectOption({ label: 'נוצר קשר' });
  } else {
    await card.dragTo(target);
  }
  await expect(target.getByRole('link', { name: 'אבי כהן' })).toBeVisible();
  await expect(board.getByRole('listitem', { name: 'נוצר קשר: 1 לידים' })).toBeVisible();

  // Lead page: stage change, note, history.
  await target.getByRole('link', { name: 'אבי כהן' }).click();
  await expect(page.getByLabel('שלב')).toHaveValue(/.+/);
  await page.getByLabel('שלב').selectOption({ label: 'הצעה נשלחה' });
  await expect(page.getByText('השלב שונה מ"נוצר קשר" ל"הצעה נשלחה"')).toBeVisible();
  await page.getByLabel('הוספת הערה').fill('נשלחה הצעה של ₪650, מחכה לאישור');
  await page.getByRole('button', { name: 'שמירת הערה' }).click();
  const history = page.getByRole('list', { name: 'היסטוריית הליד' });
  await expect(history.getByText('נשלחה הצעה של ₪650, מחכה לאישור')).toBeVisible();
  await expect(history.getByText('השלב שונה מ"חדש" ל"נוצר קשר"')).toBeVisible();

  // Search by phone in local format.
  await page.goto(`/b/${id}/leads?view=list`);
  await page.getByLabel('חיפוש לידים').fill('0541112233');
  await expect(page).toHaveURL(/q=0541112233/);
  await expect(page.getByRole('list', { name: 'פניות' }).getByRole('article')).toHaveCount(1);
  await page.getByLabel('חיפוש לידים').fill('אין כזה');
  await expect(page.getByText('לא נמצאו לידים שמתאימים לחיפוש.')).toBeVisible();
});
