import { expect, test, type Page } from '@playwright/test';

/**
 * F06: choose an address → publish → the public site serves it; draft edits stay private until
 * the next publish (AC-02, AC-03). The public server runs on :4100 (http://<sub>.lvh.me:4100).
 */
const PASSWORD = 'Sup3r-secret-pass!';
const API_HEADERS = { 'X-Requested-With': 'LeadFlow', Origin: 'http://localhost:5173' };

async function ownerWithActiveBusiness(page: Page) {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto('/register');
  await page.getByLabel('שם מלא').fill('שירן לוי');
  await page.getByLabel('אימייל').fill(`f06-${tag}@example.com`);
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
  return { id: business.id, subdomain: `e2e-${tag}` };
}

const nextSave = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().includes('/site/draft') && r.request().method() === 'PUT' && r.ok(),
  );

test('publish a site, see it live, and keep draft edits private until republishing', async ({
  page,
  context,
  isMobile,
}) => {
  const { id, subdomain } = await ownerWithActiveBusiness(page);
  await page.goto(`/b/${id}/site`);
  await page.getByRole('button', { name: 'בחירת התבנית' }).first().click();
  await expect(page.getByText('טיוטה · לא פורסם')).toBeVisible();

  // Choose an address and publish.
  await page.getByRole('button', { name: 'פרסום האתר' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('כתובת האתר').fill(subdomain);
  await dialog.getByRole('button', { name: 'שמירת הכתובת והמשך' }).click();
  await dialog.getByRole('button', { name: 'פרסום האתר' }).click();
  await expect(page.getByRole('dialog', { name: 'האתר באוויר!' })).toBeVisible();
  const liveUrl = `http://${subdomain}.lvh.me:4100/`;
  await expect(dialog.getByRole('link')).toHaveAttribute('href', liveUrl.replace(/\/$/, ''));
  await dialog.getByRole('button', { name: 'חזרה לעריכה' }).click();
  await expect(page.getByText('באוויר', { exact: true })).toBeVisible();

  // The public site serves the published version.
  const visitor = await context.newPage();
  await visitor.goto(liveUrl);
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('מספרת שירן');
  await expect(visitor.locator('html')).toHaveAttribute('dir', 'rtl');

  // Edit the draft: the live site must not change (AC-03).
  const saved = nextSave(page);
  if (isMobile) {
    await page.getByRole('button', { name: /^כותרת ראשית/ }).click();
    await page.getByLabel('כותרת', { exact: true }).fill('שירן — עיצוב שיער');
  } else {
    await page
      .frameLocator('iframe[title="תצוגה מקדימה של האתר"]')
      .locator('h1[data-edit]')
      .click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('שירן — עיצוב שיער');
    await page.keyboard.press('Enter');
  }
  await saved;
  await expect(page.getByText('באוויר · יש שינויים שלא פורסמו')).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('מספרת שירן');

  // Publish the changes: the live site updates right away (publishing clears the page cache).
  await page.getByRole('button', { name: 'פרסום השינויים' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'פרסום השינויים' }).click();
  await expect(page.getByRole('dialog', { name: 'האתר באוויר!' })).toBeVisible();
  await expect
    .poll(
      async () => {
        await visitor.reload();
        return visitor.getByRole('heading', { level: 1 }).textContent();
      },
      { timeout: 5_000 },
    )
    .toBe('שירן — עיצוב שיער');

  // Unknown addresses get the Hebrew not-found page.
  await visitor.goto('http://no-such-site-here.lvh.me:4100/');
  await expect(visitor.getByRole('heading', { name: 'האתר לא נמצא' })).toBeVisible();
});
