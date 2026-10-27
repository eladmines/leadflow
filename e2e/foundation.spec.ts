import { expect, test } from '@playwright/test';

test('anonymous / redirects to /login, rendered in Hebrew RTL', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login(\?|$)/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.getByRole('heading', { name: 'כניסה לחשבון' })).toBeVisible();
});

test('unknown routes show a Hebrew not-found state', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'העמוד לא נמצא' })).toBeVisible();
});

for (const path of ['/login', '/register']) {
  test(`${path} has no horizontal overflow at 375px`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(path);
    await expect(page.getByRole('button', { name: /כניסה|יצירת חשבון/ })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
}
