/**
 * Renders the vertical (9:16) ad with sound: node apps/landing/ad/render-vertical.mjs he|en [seconds,...]
 * With seconds it only writes those stills (PNG); without, the whole MP4 with its soundtrack.
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const lang = process.argv[2] === 'en' ? 'en' : 'he';
const stills = process.argv[3]?.split(',').map(Number);
const FPS = 30;
const out = path.join(here, 'out');
const frames = path.join(out, 'vframes-' + lang);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await (
  await browser.newContext({ viewport: { width: 1080, height: 1920 } })
).newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(`file://${path.join(here, 'vertical.html')}?lang=${lang}`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
const duration = await page.evaluate(() => window.DURATION);

if (stills) {
  for (const s of stills) {
    await page.evaluate((t) => window.render(t), s);
    await page.screenshot({ path: path.join(out, `vstill-${lang}-${s}.png`) });
  }
} else {
  const wav = path.join(out, `audio-${lang}.wav`);
  writeFileSync(wav, Buffer.from(await page.evaluate(() => window.audioWav()), 'base64'));
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
    if (f % 90 === 0) console.log(`frame ${f}/${total}`);
  }
  const mp4 = path.join(out, `leadflow-ad-vertical-${lang}.mp4`);
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      String(FPS),
      '-i',
      path.join(frames, '%05d.jpg'),
      '-i',
      wav,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '17',
      '-preset',
      'slow',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-af',
      'loudnorm=I=-14:TP=-1.5:LRA=11',
      '-shortest',
      '-movflags',
      '+faststart',
      mp4,
    ],
    { stdio: 'ignore' },
  );
  rmSync(frames, { recursive: true, force: true });
  console.log('wrote', mp4);
}
await browser.close();
