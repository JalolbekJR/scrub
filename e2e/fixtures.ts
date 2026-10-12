import type { Page } from '@playwright/test';
// Deterministic public synthetic PII, with no private document dependency.
export async function piiImage(page: Page, name = 'synthetic.png') {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 480;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1200, 480);
    ctx.fillStyle = '#000'; ctx.font = '36px Arial';
    ['Email: synthetic@example.test', 'Phone: +1 415 555 2671', 'Card: 4111 1111 1111 1111'].forEach((text, i) => ctx.fillText(text, 60, 100 + 110 * i));
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return { name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}
