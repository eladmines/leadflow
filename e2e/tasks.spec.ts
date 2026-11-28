import { expect, test, type Page } from '@playwright/test';

/** The lead's history (and facts): the "מידע" tab (D-220). Opens it if another tab is open. */
async function openLeadHistory(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const info = page.getByRole('tab', { name: 'מידע' });
  if ((await info.getAttribute('aria-selected')) !== 'true') await info.click();
}

/** F10: task from a lead → overdue on the tasks page → done → lead history; reminder email. */
const PASSWORD = 'Sup3r-secret-pass!';
const MAILPIT = 'http://localhost:8025/api/v1';
const API_HEADERS = { 'X-Requested-With': 'SimpleCatch', Origin: 'http://localhost:5173' };

async function ownerWithLead(page: Page) {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `f10-${tag}@example.com`;
  await page.goto('/register');
  await page.getByLabel('שם מלא').fill('שירן לוי');
  await page.getByLabel('אימייל').fill(email);
  await page.getByRole('textbox', { name: 'סיסמה', exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const api = (url: string, data?: object, method: 'post' | 'patch' = 'post') =>
    page.request[method](url, { headers: API_HEADERS, data });
  const { business } = await (
    await api('/api/v1/businesses', { name: 'מוסך הצפון', industry: 'garage' })
  ).json();
  await api(`/api/v1/businesses/${business.id}`, { phone: '04-8123456' }, 'patch');
  await api(`/api/v1/businesses/${business.id}/onboarding/complete`);
  const { lead } = await (
    await api(`/api/v1/businesses/${business.id}/leads`, { name: 'אבי כהן', phone: '054-1112233' })
  ).json();
  return { id: business.id as string, leadId: lead.id as string, email };
}

/** `datetime-local` value `minutes` from now (negative = past). */
const localIn = (minutes: number) => {
  const d = new Date(Date.now() + minutes * 60_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

test('a follow-up task from a lead goes overdue, gets done, and shows in the lead history', async ({
  page,
}) => {
  const { id, leadId } = await ownerWithLead(page);
  // D-220: the tasks tab is always there; its "+ משימה" opens the form.
  await page.goto(`/b/${id}/leads/${leadId}?tab=tasks`);
  const panel = page.getByRole('tabpanel');
  await expect(page.getByRole('tab', { name: /^משימות/ })).toHaveAttribute('aria-selected', 'true');
  await panel.getByRole('button', { name: '+ משימה' }).click();
  const form = page.getByRole('form', { name: 'משימה חדשה' });
  await form.getByLabel('משימה חדשה').fill('להתקשר לגבי הטיפול');
  await form.getByLabel('מועד').fill(localIn(-30));
  await form.getByRole('button', { name: 'הוספה' }).click();
  await expect(page.getByRole('list', { name: 'משימות הליד' })).toContainText('להתקשר לגבי הטיפול');
  await openLeadHistory(page);
  await expect(page.getByRole('list', { name: 'היסטוריית הליד' })).toContainText(
    'נוספה משימה: להתקשר לגבי הטיפול',
  );

  await page.goto(`/b/${id}/tasks`);
  const overdue = page.getByRole('list', { name: 'באיחור' });
  await expect(overdue).toContainText('להתקשר לגבי הטיפול');
  await expect(overdue.getByRole('link', { name: 'אבי כהן' })).toBeVisible();
  // Ticking moves it straight to the (collapsed) done group, so click and check the outcome.
  await overdue.getByRole('checkbox', { name: 'סימון כבוצעה: להתקשר לגבי הטיפול' }).click();
  await expect(page.getByRole('heading', { name: 'אין משימות פתוחות' })).toBeVisible();

  await page.goto(`/b/${id}/leads/${leadId}`);
  await openLeadHistory(page);
  await expect(page.getByRole('list', { name: 'היסטוריית הליד' })).toContainText(
    'בוצעה משימה: להתקשר לגבי הטיפול',
  );
  // Done: no longer listed among the lead's open tasks.
  await page.getByRole('tab', { name: /^משימות/ }).click();
  await expect(page.getByRole('tabpanel')).not.toContainText('להתקשר לגבי הטיפול');
});

test('completing a task in the tasks tab leaves the next one', async ({ page }) => {
  const { id, leadId } = await ownerWithLead(page);
  const api = (data: object) =>
    page.request.post(`/api/v1/businesses/${id}/tasks`, { headers: API_HEADERS, data });
  await api({ title: 'להתקשר', dueAt: new Date(Date.now() + 3_600_000).toISOString(), leadId });
  await api({
    title: 'לשלוח הצעה',
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    leadId,
  });
  await page.goto(`/b/${id}/leads/${leadId}?tab=tasks`);
  const panel = page.getByRole('tabpanel');
  await expect(panel).toContainText('להתקשר');
  await panel.getByRole('checkbox', { name: 'סימון כבוצעה: להתקשר' }).click();
  await expect(page.getByRole('tab', { name: 'משימות, 1 פתוחות' })).toBeVisible();
  await expect(panel).toContainText('לשלוח הצעה');
});

test('on a phone: the tabs, a quick-actions bar, no side scrolling', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the 375px layout');
  const { id, leadId } = await ownerWithLead(page);
  await page.goto(`/b/${id}/leads/${leadId}`);
  // D-220: the name, then all the tabs.
  await expect(page.getByRole('tablist', { name: 'חלקי הליד' })).toBeVisible();
  const bar = page.getByRole('navigation', { name: 'פעולות מהירות' });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('link', { name: 'התקשרות' })).toHaveAttribute('href', /^tel:/);
  await expect(bar.getByRole('link', { name: 'WhatsApp: פתיחה בחלון חדש' })).toHaveAttribute(
    'href',
    /wa\.me/,
  );
  // The end of the page scrolls clear of the bar.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const last = page.getByRole('button', { name: 'מחיקת הליד' });
  expect((await last.boundingBox())!.y + (await last.boundingBox())!.height).toBeLessThanOrEqual(
    (await bar.boundingBox())!.y,
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await bar.getByRole('button', { name: '+ משימה' }).click();
  await expect(
    page.getByRole('form', { name: 'משימה חדשה' }).getByLabel('משימה חדשה'),
  ).toBeFocused();
});

test('on desktop the quick-actions bar is hidden', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout');
  const { id, leadId } = await ownerWithLead(page);
  await page.goto(`/b/${id}/leads/${leadId}`);
  await expect(page.getByRole('heading', { name: 'אבי כהן', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'פעולות מהירות' })).toBeHidden();
});

test('the reminder email arrives when a task is due', async ({ page, isMobile }) => {
  test.skip(isMobile, 'server-side behaviour; one browser is enough');
  test.setTimeout(120_000);
  const { id, email } = await ownerWithLead(page);
  await page.goto(`/b/${id}/tasks`);
  const form = page.getByRole('form', { name: 'משימה חדשה' });
  await form.getByLabel('משימה חדשה').fill('לבדוק מלאי צמיגים');
  await form.getByLabel('מועד').fill(localIn(-1));
  await form.getByRole('button', { name: 'הוספה' }).click();
  await expect(page.getByRole('list', { name: 'באיחור' })).toContainText('לבדוק מלאי צמיגים');

  // The reminder job runs every minute in the server.
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `${MAILPIT}/search?query=${encodeURIComponent(`to:${email}`)}`,
        );
        const { messages } = (await res.json()) as { messages: { Subject: string }[] };
        return messages.map((m) => m.Subject);
      },
      { timeout: 90_000, intervals: [5_000] },
    )
    .toContain('תזכורת: לבדוק מלאי צמיגים');
});
