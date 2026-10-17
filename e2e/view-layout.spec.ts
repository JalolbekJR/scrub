import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openEditing } from './editor-controls';
for (const [name, width, height] of [['portrait',600,1000],['landscape',1000,400],['long',240,1800]] as const) {
 test(`${name} review preserves aspect ratio and Fit view leaves mobile tools clear`, async ({ page }) => {
  await page.setViewportSize({width:1440,height:1000}); await page.goto('/');
  const image=await page.evaluate(({width,height})=>{const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d')!;ctx.fillStyle='#ed3c5a';ctx.fillRect(0,0,width,height);return c.toDataURL('image/png').split(',')[1];},{width,height});
  await page.locator('#fileInput').setInputFiles({name:name+'.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await expect(page.locator('#btnRedact')).toBeEnabled({timeout:90000});
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
   await page.setViewportSize(viewport);const box=(await page.locator('#mainCanvas').boundingBox())!;
   expect(box.width/box.height).toBeCloseTo(width/height,3);
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await openEditing(page); await page.locator('#viewFit').click();
  const canvas=(await page.locator('#mainCanvas').boundingBox())!, toolbar=(await page.locator('#editingTools').boundingBox())!;
  expect(canvas.y+canvas.height).toBeLessThanOrEqual(toolbar.y-8);
 });
}
test('zoom and pan keep manual drawing aligned with the downloaded source pixels', async ({ page }) => {
 await page.setViewportSize({width:1440,height:1000});await page.goto('/');
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1000;c.height=400;const ctx=c.getContext('2d')!;ctx.fillStyle='#ed3c5a';ctx.fillRect(0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1];});
 await page.locator('#fileInput').setInputFiles({name:'zoom.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await expect(page.locator('#btnRedact')).toBeEnabled({timeout:90000});
 await openEditing(page);await page.locator('#viewZoom').evaluate(el=>{(el as HTMLInputElement).value='2';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#viewPan').click();const view=(await page.locator('#singleCanvasWrap').boundingBox())!;
 await page.mouse.move(view.x+250,view.y+100);await page.mouse.down();await page.mouse.move(view.x+100,view.y+100);await page.mouse.up();
 expect(await page.locator('#singleCanvasWrap').evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
 await expect(page.locator('.detection-box.manual')).toHaveCount(0);await page.locator('#btnDraw').click();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const r=(await page.locator('#mainCanvas').boundingBox())!, v=(await page.locator('#singleCanvasWrap').boundingBox())!;
 const start={x:v.x+60,y:v.y+60},end={x:v.x+180,y:v.y+180};
 const source={x:Math.floor(((start.x+end.x)/2-r.x)/r.width*1000),y:Math.floor(((start.y+end.y)/2-r.y)/r.height*400)};
 await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y);await page.mouse.up();await expect(page.locator('.detection-box.manual')).toHaveCount(1);
 await page.locator('#editorUndo').click();await expect(page.locator('.detection-box.manual')).toHaveCount(0);await page.locator('#editorRedo').click();await expect(page.locator('.detection-box.manual')).toHaveCount(1);
 const pending=page.waitForEvent('download');await page.locator('#btnRedact').click();const output=await pending;
 const pixel=await page.evaluate(async ({data,source})=>{const img=new Image();img.src='data:image/jpeg;base64,'+data;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d')!;ctx.drawImage(img,0,0);return [...ctx.getImageData(source.x,source.y,1,1).data];},{data:readFileSync(await output.path()).toString('base64'),source});
 expect(pixel.slice(0,3).every(v=>v<=8)).toBe(true);expect(pixel[3]).toBe(255);
});

test('advanced outlines do not nest active buttons inside another button role', async ({ page }) => {
 await page.goto('/');await page.locator('#fileInput').setInputFiles({name:'black.jpg',mimeType:'image/jpeg',buffer:readFileSync(new URL('../fixtures/black.jpg',import.meta.url))});await expect(page.locator('#btnRedact')).toBeEnabled({timeout:90000});
 await openEditing(page);await page.locator('#btnDraw').click();await page.locator('#addShape').click();
 await expect(page.locator('.detection-box[role="button"] button:not([hidden])')).toHaveCount(0);
});
test('a rendering failure explains recovery without downloading or losing the workspace', async ({ page }) => {
 await page.goto('/');await page.locator('#fileInput').setInputFiles({name:'black.jpg',mimeType:'image/jpeg',buffer:readFileSync(new URL('../fixtures/black.jpg',import.meta.url))});await expect(page.locator('#btnRedact')).toBeEnabled({timeout:90000});
 await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(){HTMLCanvasElement.prototype.getContext=original;throw new Error('Synthetic rendering failure');} as typeof original;});
 let downloads=0;page.on('download',()=>downloads++);await page.locator('#btnRedact').click();await expect(page.locator('#statusText')).toContainText('Could not check this copy');
 expect(downloads).toBe(0);await expect(page.locator('#canvasArea')).toBeVisible();await expect(page.locator('#celebrateBackdrop')).toBeHidden();
 const pending=page.waitForEvent('download');await page.locator('#btnRedact').click();await pending;await expect(page.locator('.hero')).toBeVisible();
});


test('view fitting does not overwrite a resized document in response to its own height change', async ({ page }) => {
 await page.goto('/'); await page.locator('#fileInput').setInputFiles({name:'portrait.png',mimeType:'image/png',buffer:readFileSync(new URL('../fixtures/astronaut.png',import.meta.url))});
 await expect(page.locator('#btnRedact')).toBeEnabled({timeout:90000});
 const width = await page.locator('#mainContainer').evaluate(async el => {
  el.style.width = '333.3px';
  for(let i=0;i<4;i++) await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  return el.style.width;
 });
 expect(width).toBe('333.3px');
});


test('responsive fitting and home reset do not create ResizeObserver delivery loops', async ({ page }) => {
 const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');await page.locator('#fileInput').setInputFiles({name:'portrait.png',mimeType:'image/png',buffer:readFileSync(new URL('../fixtures/astronaut.png',import.meta.url))});
 await expect(page.locator('#btnRedact')).toBeEnabled({timeout:90000});
 await openEditing(page);
 for(const width of [390,1440,320]) {
  await page.setViewportSize({width,height:844});await page.locator('#viewFit').click();
  await page.evaluate(async()=>{for(let i=0;i<4;i++)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));});
 }
 await page.locator('#newFile').click();await expect(page.locator('#onboarding')).toBeVisible();
 expect(errors).toEqual([]);
});
