import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const photo = { name: 'portrait.png', mimeType: 'image/png', buffer: readFileSync(new URL('../fixtures/astronaut.png', import.meta.url)) };
test('one-click protected download restores the real home with an optional retry dialog', async ({ page }) => {
 await page.goto('/'); await page.locator('#fileInput').setInputFiles(photo);
 await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 90000 });
 await expect(page.locator('#btnRedact')).toHaveAccessibleName('Download protected copy');
 await expect(page.locator('#regionInspector')).toBeHidden();
 const pending = page.waitForEvent('download'); await page.locator('#btnRedact').click();
 const download = await pending; expect([...readFileSync(await download.path()).subarray(0,3)]).toEqual([255,216,255]);
 await expect(page.locator('.hero')).toBeVisible(); await expect(page.locator('#onboarding')).toBeVisible();
 await expect(page.locator('#canvasArea')).toBeHidden(); await expect(page.locator('.detection-box')).toHaveCount(0);
 await expect(page.locator('#celebTitle')).toHaveText('Download started');
 const again = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download again', exact: true }).click();
 expect(readFileSync(await (await again).path())).toEqual(readFileSync(await download.path()));
 await page.getByRole('button', { name: 'Clean another file', exact: true }).click();
 await expect(page.locator('#celebrateBackdrop')).toBeHidden(); await expect(page.locator('#dropZone')).toBeFocused();
 await page.locator('#fileInput').setInputFiles(photo); await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 90000 });
 await expect(page.locator('#regionInspector')).toBeHidden();
});
test('Start over protects edits, resets home without a picker, and clears the next document', async ({ page }) => {
 await page.goto('/'); await page.locator('#fileInput').setInputFiles(photo); await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 90000 });
 await page.locator('#customize').click(); await page.locator('#btnDraw').click(); await page.locator('#addShape').click();
 page.once('dialog', dialog => dialog.dismiss()); await page.locator('#newFile').click();
 await expect(page.locator('.detection-box.manual')).toHaveCount(1);
 page.once('dialog', dialog => dialog.accept()); await page.locator('#homeLogo').click();
 await expect(page.locator('.hero')).toBeVisible(); await expect(page.locator('#onboarding')).toBeVisible();
 await expect(page.locator('#pdfNav')).toBeHidden(); await expect(page.locator('.detection-box')).toHaveCount(0);
 await page.locator('#fileInput').setInputFiles(photo); await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 90000 });
 await expect(page.locator('.detection-box.manual')).toHaveCount(0);
});

test('a blocked browser download keeps edits and retries the already verified revision', async ({ page }) => {
 await page.goto('/'); await page.locator('#fileInput').setInputFiles(photo); await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 90000 });
 await page.evaluate(() => {
   const state = window as Window & { encodes: number }; state.encodes = 0;
   const encode = HTMLCanvasElement.prototype.toBlob;
   HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) { if(type === 'image/jpeg') state.encodes++; encode.call(this, callback, type, quality); };
   const click = HTMLAnchorElement.prototype.click;
   HTMLAnchorElement.prototype.click = function() { if(this.download) { HTMLAnchorElement.prototype.click = click; throw new Error('Synthetic browser restriction'); } click.call(this); };
 });
 let downloads = 0; page.on('download', () => downloads++);
 await page.locator('#btnRedact').click(); await expect(page.locator('#statusText')).toContainText('could not start', { timeout: 90000 });
 await expect(page.locator('#canvasArea')).toBeVisible(); await expect(page.locator('#celebrateBackdrop')).toBeHidden();
 await expect(page.locator('#btnRedact')).toHaveAttribute('data-export-state', 'verified'); expect(downloads).toBe(0);
 const before = await page.evaluate(() => (window as Window & { encodes: number }).encodes);
 const pending = page.waitForEvent('download'); await page.locator('#btnRedact').click(); await pending;
 expect(await page.evaluate(() => (window as Window & { encodes: number }).encodes)).toBe(before);
 await expect(page.locator('.hero')).toBeVisible();
});

test('editing during verification cannot download stale bytes or reset the workspace', async ({ page }) => {
 await page.goto('/'); await page.locator('#fileInput').setInputFiles(photo); await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 90000 });
 await page.locator('#showRegions').click(); await page.getByText('Category bulk controls', { exact: true }).click();
 await page.evaluate(() => {
   const encode = HTMLCanvasElement.prototype.toBlob;
   HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
     if (type === 'image/jpeg') {
       HTMLCanvasElement.prototype.toBlob = encode;
       (window as Window & { releaseCopy?: () => void }).releaseCopy = () => encode.call(this, callback, type, quality);
     } else encode.call(this, callback, type, quality);
   };
 });
 let downloads = 0; page.on('download', () => downloads++);
 await page.locator('#btnRedact').click(); await expect(page.locator('#btnRedact')).toHaveAttribute('data-export-state', 'checking');
 await page.locator('#chkEmails').uncheck(); await page.evaluate(() => (window as Window & { releaseCopy?: () => void }).releaseCopy?.());
 await expect(page.locator('#btnRedact')).not.toHaveAttribute('aria-busy', 'true');
 expect(downloads).toBe(0); await expect(page.locator('#canvasArea')).toBeVisible(); await expect(page.locator('#celebrateBackdrop')).toBeHidden();
 const pending = page.waitForEvent('download'); await page.locator('#btnRedact').click(); await pending; await expect(page.locator('.hero')).toBeVisible();
});

test('completion retries expire and dismissal releases old actions', async ({ page }) => {
 await page.clock.install(); await page.goto('/'); await page.locator('#fileInput').setInputFiles(photo); await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 90000 });
 const pending = page.waitForEvent('download'); await page.locator('#btnRedact').click(); await pending;
 await expect(page.locator('#celebrateBackdrop')).toBeVisible();
 await page.clock.fastForward(300001); await expect(page.locator('#celebDownload')).toBeDisabled();
 let unexpected = 0; page.on('download', () => unexpected++); await page.locator('#celebDownload').dispatchEvent('click');
 expect(unexpected).toBe(0); await page.keyboard.press('Escape'); await expect(page.locator('#dropZone')).toBeFocused();
 await page.locator('#celebDownload').dispatchEvent('click'); expect(unexpected).toBe(0);
});

test('returning home cancels an OCR worker and a later file scans without reloading', async ({ page }) => {
 let ocrRequested = false;
 await page.route('**/ocr.worker*', route => { ocrRequested = true; return route.fulfill({ contentType: 'text/javascript', body: 'self.onmessage = () => {};' }); });
 await page.goto('/');
 await page.evaluate(() => {
   (window as Window & { sessionSentinel?: string }).sessionSentinel = 'same-page';
   const terminate = Worker.prototype.terminate;
   Worker.prototype.terminate = function() { (window as Window & { stoppedWorkers?: number }).stoppedWorkers = ((window as Window & { stoppedWorkers?: number }).stoppedWorkers ?? 0) + 1; terminate.call(this); };
 });
 await page.locator('#fileInput').setInputFiles(photo); await expect(page.locator('#controlsResult')).toHaveClass(/scanning/, { timeout: 90000 });
 await expect.poll(() => ocrRequested, { timeout: 90000 }).toBe(true);
 const stopped = await page.evaluate(() => (window as Window & { stoppedWorkers?: number }).stoppedWorkers ?? 0);
 await page.locator('#newFile').click(); await expect(page.locator('.hero')).toBeVisible();
 expect(await page.evaluate(() => (window as Window & { stoppedWorkers?: number }).stoppedWorkers ?? 0)).toBeGreaterThan(stopped);
 await page.unroute('**/ocr.worker*');
 await page.locator('#fileInput').setInputFiles(photo); await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 90000 });
 expect(await page.evaluate(() => (window as Window & { sessionSentinel?: string }).sessionSentinel)).toBe('same-page');
 await expect(page.locator('#controlsResult')).not.toContainText('failed');
});

test('region taps, keyboard list, zoom and responsive sizing preserve source coordinates', async ({ page }) => {
 await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/'); await page.locator('#fileInput').setInputFiles(photo); await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 90000 });
 expect((await page.locator('#mainCanvas').boundingBox())!.width).toBeGreaterThan(512);
 await expect(page.locator('#regionInspector')).toBeHidden();
 await page.locator('.detection-box').first().focus(); await page.keyboard.press('Enter');
 await expect(page.locator('#regionKeep')).toBeFocused(); await expect(page.locator('#regionAdvanced')).not.toHaveAttribute('open', '');
 await page.locator('#regionKeep').click(); await expect(page.locator('.detection-box.excluded')).toHaveCount(1);
 await page.locator('#regionKeep').click(); await expect(page.locator('.detection-box.excluded')).toHaveCount(0);
 const before = await page.locator('.detection-box.selected').evaluate(el => [el.style.left, el.style.top, el.style.width, el.style.height]);
 await page.getByRole('button', { name: 'Adjust area', exact: true }).click();
 await page.locator('#viewZoom').evaluate(el => { (el as HTMLInputElement).value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })); });
 await page.setViewportSize({ width: 1100, height: 850 });
 expect(await page.locator('.detection-box.selected').evaluate(el => [el.style.left, el.style.top, el.style.width, el.style.height])).toEqual(before);
 await page.locator('#viewFit').click(); await page.setViewportSize({ width: 390, height: 844 });
 await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.locator('#showRegions').click();
 await expect(page.getByRole('button', { name: 'Face 1, page 1', exact: true })).toBeVisible();
 page.once('dialog', dialog => dialog.accept());
 await page.locator('#newFile').click(); await expect(page.locator('.hero')).toBeVisible();
 // Empty selection represents a cancelled file chooser; the home stays canonical.
 await page.locator('#fileInput').setInputFiles([]); await expect(page.locator('#onboarding')).toBeVisible();
});

test('ten photographic face suggestions stay individually controllable without a default checkbox list', async ({ page }) => {
 await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/');
 const data = await page.evaluate(async encoded => {
   const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode();
   const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 512;
   const ctx = canvas.getContext('2d')!;
   for(let i=0;i<10;i++) ctx.drawImage(image, (i%5)*256, Math.floor(i/5)*256, 256, 256);
   return canvas.toDataURL('image/png').split(',')[1];
 }, photo.buffer.toString('base64'));
 await page.locator('#fileInput').setInputFiles({ name:'ten-portraits.png', mimeType:'image/png', buffer:Buffer.from(data,'base64') });
 await expect(page.locator('#btnRedact')).toBeEnabled({ timeout:90000 });
 const faces = page.locator('.detection-box').filter({ has:page.locator('.detection-box-label').filter({ hasText:/^FACE$/ }) });
 await expect(faces).toHaveCount(10); await expect(page.locator('#controlsResult')).toContainText('10 faces found.');
 await expect(page.locator('#regionInspector')).toBeHidden();
 await faces.nth(7).click(); await page.locator('#regionKeep').click(); await expect(page.locator('.detection-box.excluded')).toHaveCount(1);
 const box = await faces.nth(7).evaluate(el => ({ x:parseFloat(el.style.left), y:parseFloat(el.style.top), w:parseFloat(el.style.width), h:parseFloat(el.style.height) }));
 const pending=page.waitForEvent('download'); await page.locator('#btnRedact').click(); const output=await pending;
 const pixels = await page.evaluate(async ({encoded,box})=>{
   const image=new Image(); image.src='data:image/jpeg;base64,'+encoded; await image.decode();
   const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
   return { dimensions:[image.width,image.height], excluded:[...ctx.getImageData(Math.floor((box.x+box.w/2)*image.width/100),Math.floor((box.y+box.h/2)*image.height/100),1,1).data], covered:[...ctx.getImageData(112,62,1,1).data] };
 },{encoded:readFileSync(await output.path()).toString('base64'),box});
 expect(pixels.dimensions).toEqual([1280,512]);expect(pixels.covered.slice(0,3).every(v=>v<=8)).toBe(true);
 expect(pixels.excluded.slice(0,3).some(v=>v>20)).toBe(true);expect(pixels.excluded[3]).toBe(255);
});

test('the primary action in a batch file editor preserves the whole batch for review', async ({ page }) => {
 await page.goto('/');const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=300;const ctx=c.getContext('2d')!;ctx.fillStyle='#ed3c5a';ctx.fillRect(0,0,400,300);return c.toDataURL('image/png').split(',')[1];});
 const buffer=Buffer.from(data,'base64');await page.locator('#fileInput').setInputFiles([{name:'one.png',mimeType:'image/png',buffer},{name:'two.png',mimeType:'image/png',buffer}]);
 await expect(page.locator('#batchBackdrop')).toBeVisible({timeout:90000});await page.locator('.batch-file-row').filter({hasText:'one.png'}).getByRole('button',{name:'Review / Edit'}).click();
 await expect(page.locator('#btnRedact')).toBeEnabled({timeout:90000});await page.locator('#customize').click();await page.locator('#btnDraw').click();await page.locator('#addShape').click();
 const downloads:string[]=[];page.on('download',d=>downloads.push(d.suggestedFilename()));await page.locator('#btnRedact').click();
 await expect(page.locator('#batchBackdrop')).toBeVisible();expect(downloads).toEqual([]);await expect(page.locator('.batch-file-row')).toHaveCount(2);
 const pending=page.waitForEvent('download');await page.locator('#btnBatchRedact').click();const output=await pending;expect(output.suggestedFilename()).toBe('scrubbed-bundle.zip');
 const { unzipSync }=await import('fflate');const entries=unzipSync(readFileSync(await output.path()));expect(Object.keys(entries).sort()).toEqual(['scrubbed-one.jpg','scrubbed-two.jpg']);
 for(const [name,bytes] of Object.entries(entries)){
  const pixel=await page.evaluate(async data=>{const image=new Image();image.src='data:image/jpeg;base64,'+data;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);return [...ctx.getImageData(200,150,1,1).data];},Buffer.from(bytes).toString('base64'));
  if(name==='scrubbed-one.jpg')expect(pixel.slice(0,3).every(v=>v<=8)).toBe(true);else expect(pixel[0]).toBeGreaterThan(225);
 }
 await expect(page.locator('.hero')).toBeVisible();
});

test('cancelling batch review restores the full home even when the last file failed', async ({ page }) => {
 await page.goto('/');await page.locator('#fileInput').setInputFiles([{name:'black.jpg',mimeType:'image/jpeg',buffer:readFileSync(new URL('../fixtures/black.jpg',import.meta.url))},{name:'unsupported.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic unsupported input')}]);
 await expect(page.locator('#batchBackdrop')).toBeVisible({timeout:90000});await page.locator('#btnBatchCancel').click();
 await expect(page.locator('.hero')).toBeVisible();await expect(page.locator('#onboarding')).toBeVisible();await expect(page.locator('#canvasArea')).toBeHidden();
 await expect(page.locator('#fileHeader')).toBeHidden();await expect(page.locator('#dropZone')).toBeFocused();
});
