import type { Page } from '@playwright/test';

// Follow the optional editor entry point; keep the original pixel assertions.
export async function openEditing(page: Page) {
  if (await page.locator('#customize').getAttribute('aria-expanded') !== 'true') await page.locator('#customize').click();
}

export async function openGeometry(page: Page) {
  await openEditing(page);
  await openRegions(page);
  if (!await page.locator('#regionAdvanced').evaluate(el => (el as HTMLDetailsElement).open)) await page.locator('#regionAdvanced > summary').click();
}

export async function openRegions(page: Page) {
  if (!await page.locator('#regionInspector').isVisible()) await page.locator('#showRegions').click();
  if (!await page.locator('.region-browser').evaluate(el => (el as HTMLDetailsElement).open)) await page.locator('.region-browser > summary').click();
}

// Simulate a browser refusing initiation after real output verification. This
// keeps a current verified revision in the editor, so edits must invalidate it.
export async function blockNextDownload(page: Page) {
  await page.evaluate(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { HTMLAnchorElement.prototype.click = click; throw new Error('Synthetic browser download restriction'); }
      click.call(this);
    };
  });
}
