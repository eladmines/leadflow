import { expect, test, type Page } from '@playwright/test';

/** F03: app shell — navigation, mobile drawer (focus trap + Escape), keyboard, 375px layout. */
const PASSWORD = 'Sup3r-secret-pass!';
const API_HEADERS = { 'X-Requested-With': 'LeadFlow', Origin: 'http://localhost:5173' };

/** Registers through the UI, then sets up an active business through the API (faster). */
async function ownerWithActiveBusiness(page: Page) {
  const email = `f03-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  await page.goto('/register');
  await page.getByLabel('שם מלא').fill('נועה ברק');
  await page.getByLabel('אימייל').fill(email);
  await page.getByRole('textbox', { name: 'סיסמה', exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  const created = await page.request.post('/api/v1/businesses', {
    headers: API_HEADERS,
    data: { name: 'סטודיו נועה', industry: 'studio' },
  });
  const { business } = (await created.json()) as { business: { id: string } };
  await page.request.patch(`/api/v1/businesses/${business.id}`, {
    headers: API_HEADERS,
    data: { phone: '054-7654321' },
  });
  await page.request.post(`/api/v1/businesses/${business.id}/onboarding/complete`, {
    headers: API_HEADERS,
  });
  await page.goto(`/b/${business.id}`);
  await expect(page.getByRole('heading', { name: 'שלום, נועה' })).toBeVisible();
  return business.id;
}

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop sidebar only');

  test('sidebar navigation works with the keyboard and marks the current page', async ({
    page,
  }) => {
    const id = await ownerWithActiveBusiness(page);
    const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });
    await expect(nav).toBeVisible();
    await expect(page.getByRole('button', { name: 'פתיחת תפריט' })).toBeHidden();

    // Skip link is the first tab stop.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'דילוג לתוכן הראשי' })).toBeFocused();

    await nav.getByRole('link', { name: 'צוות' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/b/${id}/team$`));
    await expect(nav.getByRole('link', { name: 'צוות' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('list', { name: 'חברי הצוות' })).toContainText('נועה ברק');
  });
});

test.describe('mobile', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile drawer only');

  test('drawer traps focus, closes on Escape and returns focus; no horizontal overflow', async ({
    page,
  }) => {
    await ownerWithActiveBusiness(page);
    await page.setViewportSize({ width: 375, height: 800 });
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
    expect(await overflow()).toBe(false);

    const trigger = page.getByRole('button', { name: 'פתיחת תפריט' });
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: 'תפריט ניווט' });
    await expect(drawer).toBeVisible();

    // Focus stays inside the drawer while tabbing.
    for (let i = 0; i < 25; i += 1) await page.keyboard.press('Tab');
    expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await drawer.getByRole('link', { name: 'הגדרות וחיוב' }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('heading', { name: 'הגדרות וחיוב', level: 1 })).toBeVisible();
    expect(await overflow()).toBe(false);
  });
});
