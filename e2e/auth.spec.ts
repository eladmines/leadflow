import { expect, test, type Page } from '@playwright/test';

/**
 * F01 critical journeys against the real API + Mailpit. Dev rate limits are 10 requests per
 * 15 min per IP per route, so the request count is kept low and every run uses fresh emails.
 */
const MAILPIT = 'http://localhost:8025/api/v1';
const PASSWORD = 'Sup3r-secret-pass!';
const NEW_PASSWORD = 'An0ther-long-pass!';

const uniqueEmail = (tag: string) =>
  `qa-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

/** Polls Mailpit for the newest message to `to` whose subject matches, returns its token link. */
async function linkFromMailpit(page: Page, to: string, subject: RegExp): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await page.request.get(
          `${MAILPIT}/search?query=${encodeURIComponent(`to:${to}`)}`,
        );
        const { messages } = (await search.json()) as {
          messages: { ID: string; Subject: string }[];
        };
        const hit = messages.find((m) => subject.test(m.Subject));
        if (!hit) return undefined;
        const msg = (await (await page.request.get(`${MAILPIT}/message/${hit.ID}`)).json()) as {
          Text: string;
        };
        link = /https?:\/\/\S+\?token=[A-Za-z0-9_-]{43}/.exec(msg.Text)?.[0];
        return link;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();
  return new URL(link!).pathname + new URL(link!).search;
}

async function register(page: Page, email: string, fullName = 'דנה כהן') {
  await page.goto('/register');
  await page.getByLabel('שם מלא').fill(fullName);
  await page.getByLabel('אימייל').fill(email);
  await page.getByRole('textbox', { name: 'סיסמה', exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: `שלום, ${fullName}` })).toBeVisible();
}

async function login(page: Page, email: string, password: string) {
  await page.getByLabel('אימייל').fill(email);
  await page.getByRole('textbox', { name: 'סיסמה', exact: true }).fill(password);
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();
}

const banner = (page: Page) => page.getByRole('heading', { name: 'כדאי לאמת את כתובת האימייל' });

test('(a) register → /app greeting + unverified banner → verify link → banner gone', async ({
  page,
}) => {
  const email = uniqueEmail('verify');
  await register(page, email);
  await expect(banner(page)).toBeVisible();
  await expect(page.locator('span[dir="ltr"]', { hasText: email }).first()).toBeVisible();

  const link = await linkFromMailpit(page, email, /אימות/);
  await page.goto(link);
  await expect(page.getByText('תודה! כתובת האימייל שלך אומתה בהצלחה.')).toBeVisible();
  await page.getByRole('link', { name: 'המשך ל-LeadFlow' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'שלום, דנה כהן' })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test('(b) logout → /app redirects to /login?next=… → login returns to /app', async ({ page }) => {
  const email = uniqueEmail('logout');
  await register(page, email);
  await page.reload(); // refresh keeps the session
  await expect(page.getByRole('heading', { name: 'שלום, דנה כהן' })).toBeVisible();

  await page.getByRole('button', { name: 'התנתקות' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto('/app');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp|\/login\?next=\/app/);

  await login(page, email.toUpperCase(), PASSWORD);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'שלום, דנה כהן' })).toBeVisible();
});

test('(c) forgot → reset link → new password works; reused link shows invalid state', async ({
  page,
}) => {
  const email = uniqueEmail('reset');
  await register(page, email);
  await page.getByRole('button', { name: 'התנתקות' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto('/forgot-password');
  await page.getByLabel('אימייל').fill(email);
  await page.getByRole('button', { name: 'שליחת קישור לאיפוס' }).click();
  await expect(page.getByText('הבקשה התקבלה')).toBeVisible();

  const link = await linkFromMailpit(page, email, /סיסמה|איפוס/);
  await page.goto(link);
  await page.getByRole('textbox', { name: 'סיסמה חדשה', exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('textbox', { name: 'אימות הסיסמה החדשה', exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'שמירת הסיסמה' }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText('הסיסמה עודכנה. אפשר להתחבר')).toBeVisible();

  await login(page, email, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/app$/);

  // Reusing the same link: the reset page works signed in or not; the server rejects the token.
  await page.goto(link);
  await page.getByRole('textbox', { name: 'סיסמה חדשה', exact: true }).fill('Yet-an0ther-pass!');
  await page
    .getByRole('textbox', { name: 'אימות הסיסמה החדשה', exact: true })
    .fill('Yet-an0ther-pass!');
  await page.getByRole('button', { name: 'שמירת הסיסמה' }).click();
  await expect(page.getByRole('heading', { name: 'הקישור אינו תקף' })).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
});
