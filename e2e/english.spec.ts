import { expect, test } from '@playwright/test';

/** D-100: the app starts in English (LTR); the switch moves everything to Hebrew (RTL) and back. */
test.use({
  storageState: {
    cookies: [],
    origins: [
      {
        origin: 'http://localhost:5173',
        localStorage: [{ name: 'leadflow.tour.off', value: '1' }],
      },
    ],
  },
});

test('English by default, with a switch to Hebrew that sticks', async ({ page, isMobile }) => {
  await page.goto('/register');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Create a new account' })).toBeVisible();

  await page.getByLabel('Full name').fill('Sarah Cohen');
  await page
    .getByLabel('Email')
    .fill(`en-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Sup3r-secret-pass!');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByText('Step 1 of 4')).toBeVisible();
  await page.getByLabel(/Business name/).fill('Sarah Hair Studio');
  await page.getByLabel(/Industry/).selectOption('beauty');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Step 2 of 4')).toBeVisible();
  await page.getByLabel(/Business phone/).fill('050-1234567');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Step 3 of 4')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Step 4 of 4')).toBeVisible();
  await page.getByRole('button', { name: 'Finish and continue' }).click();

  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole('heading', { name: /Good (morning|afternoon|evening), Sarah/ }),
  ).toBeVisible();

  // Switch to Hebrew: RTL, Hebrew copy, and it survives a reload. Phones: the switch is in the menu.
  if (isMobile) await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('button', { name: 'עברית' }).last().click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(
    page.getByRole('heading', { name: /(בוקר טוב|צהריים טובים|ערב טוב), Sarah/ }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  // And back to English.
  if (isMobile) await page.getByRole('button', { name: 'פתיחת תפריט' }).click();
  await page.getByRole('button', { name: 'English' }).last().click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});
