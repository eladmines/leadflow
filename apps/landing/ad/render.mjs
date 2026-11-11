/**
 * Renders the ad to an MP4: the page is a pure function of time (`window.render(t)`), so every frame is
 * drawn exactly, screenshotted, and joined with ffmpeg. No audio.
 *
 *   node apps/landing/ad/render.mjs he            # whole video -> apps/landing/ad/out/leadflow-ad-he.mp4
 *   node apps/landing/ad/render.mjs en
 *   node apps/landing/ad/render.mjs he 3,8,12     # just those seconds as PNGs, to look at
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const lang = process.argv[2] === 'en' ? 'en' : 'he';
const stills = process.argv[3]?.split(',').map(Number);
const FPS = 30;
const out = path.join(here, 'out');
const frames = path.join(process.env.AD_FRAMES ?? path.join(here, 'out', 'frames-' + lang));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await (
  await browser.newContext({ viewport: { width: 1920, height: 1080 } })
).newPage();
await page.goto(`file://${path.join(here, 'ad.html')}?lang=${lang}`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
const duration = await page.evaluate(() => window.DURATION);

if (stills) {
  for (const s of stills) {
    await page.evaluate((t) => window.render(t), s);
    await page.screenshot({ path: path.join(out, `still-${lang}-${s}.png`) });
  }
} else {
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const total = Math.round(duration * FPS);
  for (let f = 0; f < total; f++) {
    await page.evaluate((t) => window.render(t), f / FPS);
    await page.screenshot({
      path: path.join(frames, String(f).padStart(5, '0') + '.jpg'),
      type: 'jpeg',
      quality: 94,
    });
    if (f % 60 === 0) console.log(`frame ${f}/${total}`);
  }
  const mp4 = path.join(out, `leadflow-ad-${lang}.mp4`);
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      String(FPS),
      '-i',
      path.join(frames, '%05d.jpg'),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '17',
      '-preset',
      'slow',
      '-movflags',
      '+faststart',
      mp4,
    ],
    { stdio: 'ignore' },
  );
  rmSync(frames, { recursive: true, force: true });
  console.log('wrote', mp4, readdirSync(out).length, 'files in out/');
}
await browser.close();
