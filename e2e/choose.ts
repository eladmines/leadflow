import type { Locator, Page } from '@playwright/test';

/**
 * Chooses an option in one of our dropdowns (our own menu, not a native select): opens it from its
 * button and clicks the option by its text.
 */
export async function choose(page: Page, trigger: Locator, option: string | RegExp) {
  await trigger.click();
  await page.getByRole('option', { name: option }).click();
}
