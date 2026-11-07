// Renders one still per chapter (public/stills/<chapter>.webp) and the Open Graph image (public/og.png)
// from a running dev/preview server, using the real renderer. These are the no-GPU fallback (HANDOFF §10.6).
// Usage: node scripts/make-stills.ts [--base http://localhost:4330] [--only id1,id2] [--webgl]
import { chromium, type Page } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { CHAPTERS, CHAPTER_STARTS } from '../src/time/chapters.ts';

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const base = opt('base', 'http://localhost:4340')!;
const only = opt('only')?.split(',');
const webgl = args.includes('--webgl');
/** Where in each chapter the still is taken (most representative frame). */
const AT: Record<string, number> = { recombination: 0.97, now: 0.97, planck: 0.45, inflation: 0.7, bbn: 0.35 };

mkdirSync(new URL('../public/stills/', import.meta.url), { recursive: true });
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'],
});

async function capture(page: Page, p: number, waitMs: number): Promise<Buffer> {
  await page.evaluate(
    (pp) => (window as unknown as { __driver: { scrollToProgress(p: number, o: object): void } }).__driver.scrollToProgress(pp, { immediate: true }),
    p,
  );
  await page.waitForTimeout(waitMs);
  return page.screenshot({ type: 'png' });
}

async function toWebp(page: Page, png: Buffer, quality = 0.82): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ([src, q]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${src}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d')!.drawImage(img, 0, 0);
      return c.toDataURL('image/webp', q).split(',')[1]!;
    },
    [png.toString('base64'), quality] as const,
  );
  return Buffer.from(b64, 'base64');
}

const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log(`[pageerror] ${e}`));
await page.goto(`${base}/?clean=1&tier=high&probe=0${webgl ? '&webgl=1' : ''}`);
await page.waitForFunction('!!window.__driver && !!window.__engine', null, { timeout: 60000 });
await page.waitForTimeout(3000);
for (let i = 0; i < CHAPTERS.length; i++) {
  const c = CHAPTERS[i]!;
  if (only && !only.includes(c.id)) continue;
  const p0 = CHAPTER_STARTS[i]!;
  const p1 = CHAPTER_STARTS[i + 1]!;
  const p = p0 + (p1 - p0) * (AT[c.id] ?? 0.6);
  const png = await capture(page, p, 4500);
  const webp = await toWebp(page, png);
  writeFileSync(new URL(`../public/stills/${c.id}.webp`, import.meta.url), webp);
  console.log(`stills/${c.id}.webp  ${(webp.length / 1024).toFixed(0)} KB`);
}

// Open Graph image: the title card over the opening frame.
if (!only || only.includes('og')) {
  const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await og.goto(`${base}/?clean=hero&tier=high&probe=0${webgl ? '&webgl=1' : ''}`);
  await og.waitForFunction('!!window.__driver && !!window.__engine', null, { timeout: 60000 });
  const png = await capture(og, 0, 6000);
  writeFileSync(new URL('../public/og.png', import.meta.url), png);
  console.log(`og.png  ${(png.length / 1024).toFixed(0)} KB`);
}
await browser.close();
