import type { Page } from '@playwright/test';

// Follow the optional editor entry point; keep the original pixel assertions.
export async function openEditing(page: Page) {
  if (await page.locator('#customize').getAttribute('aria-expanded') !== 'true') await page.locator('#customize').click();
}

export async function openGeometry(page: Page) {
  await openEditing(page);
  if (!await page.locator('#regionAdvanced').evaluate(el => (el as HTMLDetailsElement).open)) await page.locator('#regionAdvanced > summary').click();
}
