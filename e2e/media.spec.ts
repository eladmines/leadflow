import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

/** F05: upload a logo and a gallery image, publish, and see them load on the live site. */
const PASSWORD = 'Sup3r-secret-pass!';
const API_HEADERS = { 'X-Requested-With': 'LeadFlow', Origin: 'http://localhost:5173' };

async function ownerWithSite(page: Page) {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto('/register');
  await page.getByLabel('שם מלא').fill('שירן לוי');
  await page.getByLabel('אימייל').fill(`f05-${tag}@example.com`);
  await page.getByRole('textbox', { name: 'סיסמה', exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const api = (method: 'post' | 'patch' | 'put', url: string, data?: object) =>
    page.request[method](url, { headers: API_HEADERS, data });
  const { business } = await (
    await api('post', '/api/v1/businesses', { name: 'מספרת שירן', industry: 'beauty' })
  ).json();
  await api('patch', `/api/v1/businesses/${business.id}`, { phone: '050-1234567' });
  await api('post', `/api/v1/businesses/${business.id}/onboarding/complete`);
  await api('post', `/api/v1/businesses/${business.id}/site`, { templateKey: 'beauty' });
  await api('put', `/api/v1/businesses/${business.id}/site/subdomain`, { subdomain: `img-${tag}` });
  return { id: business.id as string, liveUrl: `http://img-${tag}.lvh.me:4100/` };
}

const nextSave = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().includes('/site/draft') && r.request().method() === 'PUT' && r.ok(),
  );

test('logo + gallery image upload, preview, publish, and load on the live site', async ({
  page,
  context,
  isMobile,
}) => {
  const { id, liveUrl } = await ownerWithSite(page);
  const png = await sharp({
    create: { width: 600, height: 300, channels: 4, background: '#9b2f52' },
  })
    .png()
    .toBuffer();
  const photo = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: '#e7c9a9' },
  })
    .jpeg()
    .toBuffer();

  await page.goto(`/b/${id}/site`);
  const preview = page.frameLocator('iframe[title="תצוגה מקדימה של האתר"]');
  // Radix dialogs (the image library) carry data-state; the on-page settings window doesn't.
  const library = page.locator('[role="dialog"][data-state="open"]');
  let saved = nextSave(page);
  if (isMobile) {
    await page.getByRole('tab', { name: 'עיצוב' }).click();
    await page.getByRole('button', { name: 'בחירת לוגו' }).click();
  } else {
    // Desktop: the logo opens the site design window.
    await preview.locator('.nav [data-img="$theme:logoAssetId"]').click();
    await page
      .getByRole('dialog', { name: 'עיצוב האתר' })
      .getByRole('button', { name: 'בחירת לוגו' })
      .click();
  }
  await library
    .getByLabel(/העלאת תמונה/)
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await saved;
  await expect(preview.locator('img.logo')).toHaveAttribute('src', /\/media\/.+\.webp$/);
  if (!isMobile)
    await page
      .getByRole('dialog', { name: 'עיצוב האתר' })
      .getByRole('button', { name: 'סגירה' })
      .click();

  // Gallery with a captioned photo.
  if (isMobile) {
    await page.getByRole('tab', { name: 'מקטעים' }).click();
    await page.getByLabel('הוספת מקטע').selectOption('gallery');
    await page.getByRole('button', { name: 'הוספה', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'הוספת מקטע', exact: true }).click();
    await page
      .getByRole('list', { name: 'הוספת מקטע לעמוד' })
      .getByRole('button', { name: 'גלריה' })
      .click();
  }
  await page.getByRole('button', { name: 'הוספת תמונה' }).click();
  await library
    .getByLabel(/העלאת תמונה/)
    .setInputFiles({ name: 'salon.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(library).toBeHidden();
  saved = nextSave(page);
  await page.getByLabel('כיתוב לתמונה 1').fill('הסלון מבפנים');
  await saved;
  await expect(preview.getByRole('img', { name: 'הסלון מבפנים' })).toBeVisible();

  // Publish and check the live site.
  await page.getByRole('button', { name: 'פרסום האתר' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'פרסום האתר' }).click();
  await expect(page.getByRole('dialog', { name: 'האתר באוויר!' })).toBeVisible();

  const visitor = await context.newPage();
  await visitor.goto(liveUrl);
  const logo = visitor.locator('img.logo');
  await expect(logo).toBeVisible();
  const gallery = visitor.getByRole('img', { name: 'הסלון מבפנים' });
  await gallery.scrollIntoViewIfNeeded();
  await expect(gallery).toBeVisible();
  // Images really load (decoded, re-encoded to ≤1920px) from the site's own origin.
  await expect
    .poll(() => gallery.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
    .toBe(1920);
  expect(await logo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(600);
  expect(await logo.getAttribute('src')).toMatch(/^\/media\//);
});
