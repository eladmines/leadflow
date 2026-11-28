import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { choose } from './choose';

/** The lead's history (and facts): the "מידע" tab (D-220). Opens it if another tab is open. */
async function openLeadHistory(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const info = page.getByRole('tab', { name: 'מידע' });
  if ((await info.getAttribute('aria-selected')) !== 'true') await info.click();
}

/** The custom-field form: "פרטים" in the "מידע" tab (D-220). */
async function editLeadFields(page: Page, formName = 'פרטים') {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const info = page.getByRole('tab', { name: 'מידע' });
  if ((await info.getAttribute('aria-selected')) !== 'true') await info.click();
  await expect(page.getByRole('form', { name: formName })).toBeVisible();
}

/**
 * F34 custom lead fields (QA): owner creates a field of each type → New lead fills them (required
 * enforced) → lead card edits inline → history → leads list filter → archive (gone from New lead
 * and filters, value still on the lead) → quick "add customer" from a quote skips required (D-205).
 * Plus keyboard reorder, error/empty/no-permission states, 375px, and English (LTR).
 */
const PASSWORD = 'Sup3r-secret-pass!';
const API_HEADERS = { 'X-Requested-With': 'SimpleCatch', Origin: 'http://localhost:5173' };
const MAILPIT = 'http://localhost:8025/api/v1';
const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function ownerWithBusiness(page: Page, email = `f34-${tag()}@example.com`) {
  await page.request.post('/api/v1/auth/register', {
    headers: API_HEADERS,
    data: { fullName: 'שירן לוי', email, password: PASSWORD, acceptTerms: true },
  });
  const { business } = await (
    await page.request.post('/api/v1/businesses', {
      headers: API_HEADERS,
      data: { name: 'אולמות הצפון', industry: 'events' },
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

async function apiField(page: Page, id: string, data: object) {
  const res = await page.request.post(`/api/v1/businesses/${id}/lead-fields`, {
    headers: API_HEADERS,
    data,
  });
  expect(res.status()).toBe(201);
  return (await res.json()).field as { id: string; options: { id: string; label: string }[] };
}

async function addFieldInUi(
  page: Page,
  opts: {
    label: string;
    type: string;
    options?: string[];
    min?: string;
    max?: string;
    required?: boolean;
  },
) {
  await page.getByRole('button', { name: 'הוספת שדה' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'שדה חדש' });
  await dialog.getByLabel(/^שם השדה/).fill(opts.label);
  if (opts.type !== 'טקסט') await choose(page, dialog.getByLabel(/^סוג השדה/), opts.type);
  if (opts.options) {
    for (const [i, o] of opts.options.entries()) {
      if (i >= 2) await dialog.getByRole('button', { name: 'הוספת אפשרות' }).click();
      await dialog.getByLabel(`אפשרות ${i + 1}`, { exact: true }).fill(o);
    }
  }
  if (opts.min) await dialog.getByLabel('ערך מינימלי').fill(opts.min);
  if (opts.max) await dialog.getByLabel('ערך מקסימלי').fill(opts.max);
  if (opts.required) await dialog.getByLabel('שדה חובה').check();
  await dialog.getByRole('button', { name: 'הוספת השדה' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'שדות פעילים' })).toContainText(opts.label);
}

/** Elements sticking out of the viewport sideways (empty = fits), for a readable failure. */
const overflowing = (page: Page) =>
  page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= w) return [];
    return [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > w + 1 || r.left < -1);
      })
      .slice(-6)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const name = el.getAttribute('aria-label') ?? (el as HTMLElement).innerText?.slice(0, 40);
        return `${el.tagName.toLowerCase()} [${Math.round(r.left)}..${Math.round(r.right)}] ${name ?? ''}`;
      });
  });

const noHorizontalScroll = async (page: Page) => expect.poll(() => overflowing(page)).toEqual([]);

test('owner defines fields, fills them on a lead, edits, filters and archives', async ({
  page,
}) => {
  const id = await ownerWithBusiness(page);
  await page.goto(`/b/${id}/leads/fields`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  // D-206: lead fields have their own page under Leads.
  await expect(page.getByRole('heading', { name: 'שדות לידים', level: 1 })).toBeVisible();
  await expect(page.getByText('עדיין אין שדות משלכם')).toBeVisible(); // empty state

  await addFieldInUi(page, { label: 'דגם רכב', type: 'טקסט', required: true });
  await addFieldInUi(page, { label: 'אורחים', type: 'מספר', min: '0', max: '500' });
  await addFieldInUi(page, { label: 'תאריך האירוע', type: 'תאריך' });
  await addFieldInUi(page, {
    label: 'סוג טיפול',
    type: 'בחירה מרשימה',
    options: ['פנים', 'גוף', 'ציפורניים'],
  });
  await addFieldInUi(page, { label: 'VIP', type: 'תיבת סימון' });
  await expect(page.getByText('5 מתוך 20 שדות פעילים')).toBeVisible();

  // Duplicate label (case-insensitive) is refused in Hebrew inside the dialog.
  await page.getByRole('button', { name: 'הוספת שדה' }).first().click();
  const dup = page.getByRole('dialog', { name: 'שדה חדש' });
  await dup.getByLabel(/^שם השדה/).fill('vip');
  await dup.getByRole('button', { name: 'הוספת השדה' }).click();
  await expect(dup.getByText('כבר יש שדה פעיל בשם הזה')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dup).toHaveCount(0);

  // New lead: required blocks saving, then every type is filled.
  await page.goto(`/b/${id}/leads?view=list`);
  await page.getByRole('button', { name: 'ליד חדש' }).click();
  const dialog = page.getByRole('dialog', { name: 'ליד חדש' });
  await dialog.getByLabel(/^שם/).fill('אבי כהן');
  await dialog.getByLabel('טלפון').fill('054-1112233');
  await expect(dialog.getByRole('group', { name: 'פרטים נוספים' })).toBeVisible();
  await dialog.getByRole('button', { name: 'יצירת ליד' }).click();
  await expect(dialog.getByText('זהו שדה חובה')).toBeVisible();
  await dialog.getByLabel(/^דגם רכב/).fill('מאזדה 3');
  await dialog.getByLabel(/^אורחים/).fill('600');
  await dialog.getByRole('button', { name: 'יצירת ליד' }).click();
  await expect(dialog.getByText('המספר צריך להיות לכל היותר 500')).toBeVisible();
  await dialog.getByLabel(/^אורחים/).fill('120');
  await dialog.getByLabel(/^תאריך האירוע/).fill('2027-06-15');
  await choose(page, dialog.getByLabel(/^סוג טיפול/), 'גוף');
  await dialog.getByLabel('VIP').check();
  await dialog.getByRole('button', { name: 'יצירת ליד' }).click();
  await expect(page.getByRole('heading', { name: 'אבי כהן', level: 1 })).toBeVisible();

  // Lead card: "מה ביקשו" shows the values; "עריכה" opens the form, saved with one "שמירה"
  // (D-207, D-211).
  await editLeadFields(page);
  const save = page.getByRole('form', { name: 'פרטים' }).getByRole('button', { name: 'שמירה' });
  const model = page.getByLabel(/^דגם רכב/);
  await expect(model).toHaveValue('מאזדה 3');
  await expect(page.getByLabel(/^אורחים/)).toHaveValue('120');
  await expect(page.getByLabel(/^תאריך האירוע/)).toHaveValue('2027-06-15');
  await expect(page.getByLabel('VIP')).toBeChecked();
  // Clearing a required field is refused on the card.
  await model.fill('');
  await save.click();
  await expect(page.getByText('זהו שדה חובה')).toBeVisible();
  await model.fill('טויוטה קורולה');
  await save.click();
  await expect(page.getByText('השינויים נשמרו')).toBeVisible();
  // The full history is in "מידע" (D-220).
  await openLeadHistory(page);
  const history = page.getByRole('list', { name: 'היסטוריית הליד' });
  await expect(history).toContainText('דגם רכב');
  await expect(history).toContainText('טויוטה קורולה');
  await expect(history).toContainText('מאזדה 3');

  // A second lead without values, for the filters.
  await page.request.post(`/api/v1/businesses/${id}/leads`, {
    headers: API_HEADERS,
    data: { name: 'דנה לוי', phone: '054-9998877', skipRequiredCustomFields: true },
  });

  // Leads list: filter by the choice field and by the checkbox.
  await page.goto(`/b/${id}/leads?view=list`);
  const list = page.getByRole('list', { name: 'פניות' });
  await expect(list.getByRole('article')).toHaveCount(2);
  await page
    .getByRole('button', { name: /^סינון/ })
    .first()
    .click();
  const filters = page.getByRole('group', { name: 'סינון לפי שדות נוספים' });
  await expect(filters).toBeVisible();
  await choose(page, filters.getByLabel('סוג טיפול'), 'גוף');
  await expect(page).toHaveURL(/cf%5B[0-9a-f-]{36}%5D=|cf\[[0-9a-f-]{36}\]=/);
  await expect(list.getByRole('article')).toHaveCount(1);
  await expect(list).toContainText('אבי כהן');
  await choose(page, filters.getByLabel('סוג טיפול'), 'הכל');
  await choose(page, filters.getByLabel('VIP'), 'לא מסומן');
  await expect(list.getByRole('article')).toHaveCount(1);
  await expect(list).toContainText('דנה לוי');
  await choose(page, filters.getByLabel('VIP'), 'הכל');
  await filters.getByLabel('דגם רכב').fill('קורולה');
  await expect(list.getByRole('article')).toHaveCount(1);
  await expect(list).toContainText('אבי כהן');

  // Archive the choice field.
  await page.goto(`/b/${id}/leads/fields`);
  await page.getByRole('button', { name: 'העברת סוג טיפול לארכיון' }).click();
  await page.getByRole('button', { name: 'העברה לארכיון', exact: true }).click();
  await expect(page.getByRole('list', { name: 'שדות בארכיון' })).toContainText('סוג טיפול');
  await expect(page.getByRole('list', { name: 'שדות פעילים' })).not.toContainText('סוג טיפול');

  // Gone from New lead and from filters; the old value still shows on the lead, read-only.
  await page.goto(`/b/${id}/leads?view=list`);
  await page
    .getByRole('button', { name: /^סינון/ })
    .first()
    .click();
  await expect(page.getByRole('group', { name: 'סינון לפי שדות נוספים' })).not.toContainText(
    'סוג טיפול',
  );
  await page.getByRole('button', { name: 'ליד חדש' }).click();
  await expect(page.getByRole('dialog', { name: 'ליד חדש' }).getByText('סוג טיפול')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'אבי כהן' }).first().click();
  await openLeadHistory(page);
  await expect(page.getByRole('heading', { name: 'שדות בארכיון' })).toBeVisible();
  const archivedSection = page.getByRole('region', { name: 'שדות בארכיון' });
  await expect(archivedSection).toContainText('סוג טיפול');
  await expect(archivedSection).toContainText('גוף');
});

test('quick "new customer" from a quote is not blocked by a required field (D-205)', async ({
  page,
}) => {
  const id = await ownerWithBusiness(page);
  await apiField(page, id, { label: 'דגם רכב', type: 'text', required: true });
  await page.goto(`/b/${id}/quotes`);
  await page.getByRole('link', { name: 'הצעת מחיר חדשה' }).first().click();
  await page.getByRole('button', { name: 'לקוח חדש' }).click();
  const dialog = page.getByRole('dialog', { name: 'לקוח חדש' });
  await expect(dialog.getByText('דגם רכב')).toHaveCount(0);
  await dialog.getByLabel(/^שם/).fill('יעל מזרחי');
  await dialog.getByLabel('טלפון').fill('052-3334455');
  const created = page.waitForResponse(
    (r) => r.url().endsWith(`/businesses/${id}/leads`) && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'הוספת לקוח' }).click();
  const res = await created;
  expect(res.status()).toBe(201);
  expect(res.request().postDataJSON()).toMatchObject({ skipRequiredCustomFields: true });
  await expect(dialog).toHaveCount(0);
});

test('reorder arrows and inputs are reachable and usable by keyboard only', async ({ page }) => {
  const id = await ownerWithBusiness(page);
  for (const label of ['ראשון', 'שני', 'שלישי']) await apiField(page, id, { label, type: 'text' });
  await page.goto(`/b/${id}/leads/fields`);
  const active = page.getByRole('list', { name: 'שדות פעילים' });
  await expect(active.getByRole('listitem')).toHaveCount(3);

  // Tab from the back link at the top until "move שלישי up" has focus: keyboard reachable, in order.
  await page.getByRole('link', { name: 'כל הלידים' }).focus();
  const target = page.getByRole('button', { name: 'הזזת שלישי למעלה' });
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await target.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  await page.keyboard.press('Enter');
  await expect(active.getByRole('listitem').nth(1)).toContainText('שלישי');
  await page.keyboard.press('Enter'); // focus stays on the moved field's arrow
  await expect(active.getByRole('listitem').first()).toContainText('שלישי');
  // The move is announced to screen readers and saved on the server.
  await expect(
    page.getByRole('status').filter({ hasText: 'השדה שלישי הועבר למקום 1' }),
  ).toHaveCount(1);
  const saved = await (await page.request.get(`/api/v1/businesses/${id}/lead-fields`)).json();
  expect(saved.fields.map((f: { label: string }) => f.label)).toEqual(['שלישי', 'ראשון', 'שני']);
  await expect(page.getByRole('button', { name: 'הזזת שלישי למעלה' })).toBeDisabled();

  // Add-field dialog by keyboard: open, type, choose, save.
  await page.getByRole('button', { name: 'הוספת שדה' }).first().focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'שדה חדש' });
  // Focus moves into the dialog; the name input is reachable by Tab.
  await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  const name = dialog.getByLabel(/^שם השדה/);
  for (let i = 0; i < 6 && !(await name.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press('Tab');
  await expect(name).toBeFocused();
  await page.keyboard.type('רביעי');
  await dialog.getByRole('button', { name: 'הוספת השדה' }).focus();
  await page.keyboard.press('Enter');
  await expect(active).toContainText('רביעי');
});

test('error and retry when the fields can not load', async ({ page }) => {
  const id = await ownerWithBusiness(page);
  await apiField(page, id, { label: 'דגם', type: 'text' });
  let fail = true;
  await page.route(`**/api/v1/businesses/${id}/lead-fields`, (route) =>
    fail
      ? route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' } }),
        })
      : route.continue(),
  );
  await page.goto(`/b/${id}/leads/fields`);
  await expect(page.getByText('לא הצלחנו לטעון את השדות')).toBeVisible({ timeout: 15_000 });
  fail = false;
  await page.getByRole('button', { name: 'לנסות שוב' }).click();
  await expect(page.getByRole('list', { name: 'שדות פעילים' })).toContainText('דגם');
});

test.describe('375px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('settings fields, the add dialog and the lead card fit 375px', async ({ page }) => {
    const id = await ownerWithBusiness(page);
    await apiField(page, id, { label: 'שם ארוך מאוד של שדה מותאם אישית לבדיקה', type: 'text' });
    const sel = await apiField(page, id, {
      label: 'בחירה',
      type: 'select',
      options: [{ label: 'קצר' }, { label: 'ב' }],
    });
    const { lead } = await (
      await page.request.post(`/api/v1/businesses/${id}/leads`, {
        headers: API_HEADERS,
        data: { name: 'רון', phone: '050-1112233', customFields: { [sel.id]: sel.options[0]!.id } },
      })
    ).json();
    await page.goto(`/b/${id}/leads/fields`);
    await expect(page.getByRole('list', { name: 'שדות פעילים' })).toBeVisible();
    await noHorizontalScroll(page);
    await page.getByRole('button', { name: 'הוספת שדה' }).first().click();
    await choose(page, page.getByRole('dialog').getByLabel(/^סוג השדה/), 'בחירה מרשימה');
    await noHorizontalScroll(page);
    await page.keyboard.press('Escape');
    await page.goto(`/b/${id}/leads/${lead.id}`);
    await editLeadFields(page);
    await expect(page.getByLabel(/^שם ארוך מאוד/)).toBeVisible(); // fields loaded, not the spinner
    await expect(page.getByLabel(/^בחירה/)).toContainText('קצר');
    await noHorizontalScroll(page);
  });

  test('a lead whose choice value has a long option label fits 375px', async ({ page }) => {
    const id = await ownerWithBusiness(page);
    const sel = await apiField(page, id, {
      label: 'בחירה',
      type: 'select',
      options: [{ label: 'אפשרות ארוכה מאוד מאוד מאוד מאוד מאוד מאוד' }, { label: 'ב' }],
    });
    const { lead } = await (
      await page.request.post(`/api/v1/businesses/${id}/leads`, {
        headers: API_HEADERS,
        data: { name: 'רון', phone: '050-1112233', customFields: { [sel.id]: sel.options[0]!.id } },
      })
    ).json();
    await page.goto(`/b/${id}/leads/${lead.id}`);
    await noHorizontalScroll(page); // the read view
    await editLeadFields(page);
    await expect(page.getByLabel(/^בחירה/)).toContainText('אפשרות ארוכה');
    await noHorizontalScroll(page);
  });

  test('baseline: the lead page of a business without custom fields fits 375px', async ({
    page,
  }) => {
    const id = await ownerWithBusiness(page);
    const { lead } = await (
      await page.request.post(`/api/v1/businesses/${id}/leads`, {
        headers: API_HEADERS,
        data: { name: 'רון', phone: '050-1112233' },
      })
    ).json();
    await page.goto(`/b/${id}/leads/${lead.id}`);
    await expect(page.getByRole('heading', { name: 'רון', level: 1 })).toBeVisible();
    await noHorizontalScroll(page);
  });
});

async function employeeOf(browser: Browser, page: Page, businessId: string) {
  const email = `f34-emp-${tag()}@example.com`;
  expect(
    (
      await page.request.post(`/api/v1/businesses/${businessId}/invitations`, {
        headers: API_HEADERS,
        data: { email, role: 'EMPLOYEE' },
      })
    ).status(),
  ).toBe(201);
  let token = '';
  await expect
    .poll(
      async () => {
        const { messages } = (await (
          await page.request.get(`${MAILPIT}/search?query=${encodeURIComponent(`to:${email}`)}`)
        ).json()) as { messages: { ID: string }[] };
        if (!messages[0]) return '';
        const msg = (await (
          await page.request.get(`${MAILPIT}/message/${messages[0].ID}`)
        ).json()) as {
          Text: string;
        };
        token = /invite\?token=([A-Za-z0-9_-]{43})/.exec(msg.Text)?.[1] ?? '';
        return token;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();
  const ctx = await browser.newContext();
  const emp = await ctx.newPage();
  await emp.request.post('/api/v1/auth/register', {
    headers: API_HEADERS,
    data: { fullName: 'יוסי מזרחי', email, password: PASSWORD, acceptTerms: true },
  });
  const accepted = await emp.request.post('/api/v1/invitations/accept', {
    headers: API_HEADERS,
    data: { token },
  });
  expect(accepted.status()).toBe(200);
  return { emp, ctx };
}

test('an employee sees the no-permission state and can still fill values', async ({
  page,
  browser,
}) => {
  const id = await ownerWithBusiness(page);
  const f = await apiField(page, id, { label: 'דגם רכב', type: 'text' });
  const { emp, ctx } = await employeeOf(browser, page, id);
  await emp.goto(`/b/${id}/leads/fields`);
  await expect(emp.getByRole('button', { name: 'הוספת שדה' })).toHaveCount(0);
  await expect(emp.getByRole('list', { name: 'שדות פעילים' })).toHaveCount(0);
  await expect(emp.getByText(/שדות הלידים/)).toBeVisible(); // NoPermission names what's missing
  // Server-side, too.
  const res = await emp.request.post(`/api/v1/businesses/${id}/lead-fields`, {
    headers: API_HEADERS,
    data: { label: 'x', type: 'text' },
  });
  expect(res.status()).toBe(403);
  // Their own lead: the Details block is editable.
  const { lead } = await (
    await emp.request.post(`/api/v1/businesses/${id}/leads`, {
      headers: API_HEADERS,
      data: { name: 'מיכל', phone: '050-7771111' },
    })
  ).json();
  await emp.goto(`/b/${id}/leads/${lead.id}`);
  await editLeadFields(emp);
  const input = emp.getByLabel(/^דגם רכב/);
  await input.fill('סקודה');
  await input.press('Enter');
  await expect
    .poll(async () => {
      const r = await emp.request.get(`/api/v1/businesses/${id}/leads/${lead.id}`);
      return (await r.json()).lead.customFields[f.id];
    })
    .toBe('סקודה');
  await ctx.close();
});

test.describe('English', () => {
  test.use({
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:5173',
          localStorage: [
            { name: 'simplecatch.tour.off', value: '1' },
            { name: 'simplecatch.helper.quiet', value: '1' },
            { name: 'simplecatch.locale', value: 'en' },
          ],
        },
      ],
    },
  });

  const hebrewIn = async (loc: Locator, allowed: string[]) => {
    let text = await loc.innerText();
    for (const a of allowed) text = text.split(a).join('');
    return text.match(/[֐-׿]+/g) ?? [];
  };

  test('settings, New lead and the lead card are English and LTR', async ({ page }) => {
    const id = await ownerWithBusiness(page);
    const sel = await apiField(page, id, {
      label: 'סוג טיפול',
      type: 'select',
      options: [{ label: 'פנים' }, { label: 'גוף' }],
      required: true,
    });
    await apiField(page, id, { label: 'Guests', type: 'number', min: 1, max: 50 });
    await page.goto(`/b/${id}/leads/fields`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { name: 'Lead fields', level: 1 })).toBeVisible();
    const panel = page.locator('main');
    await expect(panel.getByRole('list', { name: 'Active fields' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Move Guests up' })).toBeVisible();
    // Only the business's own labels may be Hebrew.
    expect(await hebrewIn(panel, ['סוג טיפול', 'פנים', 'גוף', 'שירן לוי'])).toEqual([]);

    await page.goto(`/b/${id}/leads?view=list`);
    await page.getByRole('button', { name: 'New lead' }).click();
    const dialog = page.getByRole('dialog', { name: 'New lead' });
    await dialog.getByRole('button', { name: 'Create lead' }).click();
    await expect(dialog.getByText('This field is required')).toBeVisible();
    expect(await hebrewIn(dialog, ['סוג טיפול', 'שירן לוי'])).toEqual([]);
    await page.keyboard.press('Escape');

    const { lead } = await (
      await page.request.post(`/api/v1/businesses/${id}/leads`, {
        headers: API_HEADERS,
        data: { name: 'Ron', phone: '050-1112233', customFields: { [sel.id]: sel.options[0]!.id } },
      })
    ).json();
    await page.goto(`/b/${id}/leads/${lead.id}`);
    await editLeadFields(page, 'Details');
    await expect(page.getByRole('heading', { name: 'The lead', exact: true })).toBeVisible();
    await page.getByLabel(/^Guests/).fill('99');
    await page.getByLabel(/^Guests/).press('Enter');
    await expect(page.getByText('The number must be at most 50')).toBeVisible();
  });
});
