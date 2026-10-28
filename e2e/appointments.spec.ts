import { expect, test, type Page } from '@playwright/test';

/** F17: services → book from the calendar → a clashing booking is refused → cancel → lead card. */
const PASSWORD = 'Sup3r-secret-pass!';
const API_HEADERS = { 'X-Requested-With': 'LeadFlow', Origin: 'http://localhost:5173' };

async function owner(page: Page) {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto('/register');
  await page.getByLabel('שם מלא').fill('שירן לוי');
  await page.getByLabel('אימייל').fill(`f17-${tag}@example.com`);
  await page.getByRole('textbox', { name: 'סיסמה', exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const api = (url: string, data?: object, method: 'post' | 'patch' = 'post') =>
    page.request[method](url, { headers: API_HEADERS, data });
  const { business } = await (
    await api('/api/v1/businesses', { name: 'מספרת שירן', industry: 'beauty' })
  ).json();
  await api(`/api/v1/businesses/${business.id}`, { phone: '050-1234567' }, 'patch');
  await api(`/api/v1/businesses/${business.id}/onboarding/complete`);
  return business.id as string;
}

test('book, clash, cancel, and see it from the calendar', async ({ page }) => {
  const id = await owner(page);
  await page.goto(`/b/${id}/appointments`);

  // Define a service.
  await page.getByRole('button', { name: 'שירותים' }).click();
  await page.getByLabel('שירות חדש').fill('תספורת');
  await page.getByLabel('משך (דק׳)').fill('45');
  await page.getByRole('button', { name: 'הוספה', exact: true }).click();
  await expect(page.getByRole('list', { name: 'רשימת שירותים' })).toContainText('תספורת');

  // Book a new customer tomorrow at 10:00.
  const tomorrow = new Date(Date.now() + 86_400_000);
  const ymd = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const bookAt = async (name: string, phone: string) => {
    await page.getByRole('button', { name: 'תור חדש' }).click();
    const dialog = page.getByRole('dialog', { name: 'תור חדש' });
    await dialog.getByLabel('שם הלקוח').fill(name);
    await dialog.getByLabel('טלפון').fill(phone);
    await dialog.getByLabel('שירות').selectOption({ label: 'תספורת · 45 דק׳' });
    await dialog.getByLabel('תאריך').fill(ymd);
    await dialog.getByLabel('שעה').fill('10:00');
    await dialog.getByRole('button', { name: 'קביעת התור' }).click();
    return dialog;
  };
  await page.goto(`/b/${id}/appointments?date=${ymd}`);
  const first = await bookAt('רון לוי', '052-1112233');
  await expect(first).toBeHidden();
  const chip = page.getByRole('button', { name: /רון לוי/ });
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('10:00');

  // The same slot for the same staff member is refused.
  const second = await bookAt('דנה כהן', '052-7654321');
  await expect(second.getByText(/יש כבר תור בזמן הזה/)).toBeVisible();
  await page.keyboard.press('Escape');

  // Cancel the first; it stays visible as cancelled.
  await chip.click();
  await page.getByRole('button', { name: 'ביטול התור' }).click();
  await expect(page.getByRole('button', { name: /רון לוי/ })).toContainText('בוטל');
});
