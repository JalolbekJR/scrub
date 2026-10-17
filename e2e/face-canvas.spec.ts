import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('face scanning uses real DOM WebGL when OffscreenCanvas WebGL is unavailable', async ({ page }) => {
 await page.addInitScript(() => {
  const get = OffscreenCanvas.prototype.getContext;
  OffscreenCanvas.prototype.getContext = function(type: string, ...args: unknown[]) {
   if (String(type).startsWith('webgl')) return null;
   return Reflect.apply(get, this, [type, ...args]);
  } as typeof get;
 });
 await page.goto('/');
 expect(await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'))).toBe(true);
 await page.locator('#fileInput').setInputFiles({name:'portrait.png',mimeType:'image/png',buffer:readFileSync(new URL('../fixtures/astronaut.png',import.meta.url))});
 await expect(page.locator('#controlsResult')).toBeVisible();
 await expect(page.locator('#controlsResult')).not.toHaveClass(/scanning/,{timeout:90000});
 expect(await page.locator('#controlsResult').innerText()).toContain('1 face found.');
 const pending = page.waitForEvent('download');await page.locator('#btnRedact').click();const output=await pending;
 const bytes=readFileSync(await output.path());expect([...bytes.subarray(0,3)]).toEqual([255,216,255]);
 const pixels=await page.evaluate(async encoded=>{
  const image=new Image();image.src='data:image/jpeg;base64,'+encoded;await image.decode();
  const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);
  return {size:[c.width,c.height],face:[...ctx.getImageData(225,120,1,1).data]};
 },bytes.toString('base64'));
 expect(pixels.size).toEqual([512,512]);expect(pixels.face.slice(0,3).every(v=>v<=8)).toBe(true);expect(pixels.face[3]).toBe(255);
 await expect(page.locator('#onboarding')).toBeVisible();
});
