import { expect, test } from '@playwright/test';

const PASSWORD = 'Sup3r-secret-pass!';
const API = { 'X-Requested-With': 'LeadFlow', Origin: 'http://localhost:5173' };

test('probe page heights', async ({ page }, info) => {
  const email = `probe-${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('שם מלא').fill('נועה ברק');
  await page.getByLabel('אימייל').fill(email);
  await page.getByRole('textbox', { name: 'סיסמה', exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const created = await page.request.post('/api/v1/businesses', {
    headers: API,
    data: { name: 'סטודיו נועה', industry: 'studio' },
  });
  const { business } = (await created.json()) as { business: { id: string } };
  await page.request.patch(`/api/v1/businesses/${business.id}`, { headers: API, data: { phone: '054-7654321' } });
  await page.request.post(`/api/v1/businesses/${business.id}/onboarding/complete`, { headers: API });
  for (const seg of ['', 'leads', 'customers', 'conversations', 'tasks', 'appointments', 'quotes', 'reports', 'team', 'settings', 'site']) {
    await page.goto(`/b/${business.id}/${seg}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const se = document.scrollingElement!;
      const main = document.getElementById('main')!;
      const last = [...main.children].at(-1) as HTMLElement | undefined;
      const contentBottom = last ? last.getBoundingClientRect().bottom + window.scrollY : 0;
      const scrollers = [...document.querySelectorAll<HTMLElement>('*')]
        .filter((el) => {
          const s = getComputedStyle(el);
          return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 2;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')} ${el.clientHeight}/${el.scrollHeight}`);
      const wide = [...document.querySelectorAll<HTMLElement>('main *')]
        .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1 || el.getBoundingClientRect().left < -1)
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 4).join('.')}`);
      return {
        viewport: window.innerHeight,
        page: se.scrollHeight,
        mainH: Math.round(main.getBoundingClientRect().height),
        blankUnderContent: Math.round(se.scrollHeight - contentBottom),
        hScroll: se.scrollWidth > se.clientWidth,
        scrollers,
        wide,
      };
    });
    console.log(`[${info.project.name}] /${seg || '(dashboard)'} ${JSON.stringify(m)}`);
  }
});
