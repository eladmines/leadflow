import { expect, test } from '@playwright/test';

test('app renders in Hebrew RTL and reports a healthy backend', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('השרת ומסד הנתונים זמינים')).toBeVisible();
});

test('unknown routes show a Hebrew not-found state', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'העמוד לא נמצא' })).toBeVisible();
});

test('layout has no horizontal overflow on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
