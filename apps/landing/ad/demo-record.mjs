/**
 * Records a walkthrough of the REAL LeadFlow app (Hebrew) as a video, with a visible cursor and captions.
 *
 *   1. docker compose up -d; a database with the demo account (pnpm db:seed, then seed:demo for sample data)
 *   2. API on :4000 and web on :5173 (pnpm dev), pointed at that database
 *   3. node apps/landing/ad/demo-record.mjs   → apps/landing/ad/out/leadflow-demo-he.mp4
 *
 * Login: owner@leadflow.test / LeadFlow-demo-1 (the development seed's account).
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
const raw = path.join(out, 'demo-raw');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const W = 1600;
const H = 900;
mkdirSync(out, { recursive: true });
rmSync(raw, { recursive: true, force: true });
mkdirSync(raw, { recursive: true });

const browser = await chromium.launch();

// 1. sign in once, off camera
const login = await browser.newContext({ viewport: { width: W, height: H } });
await login.addInitScript(() => localStorage.setItem('leadflow.locale', 'he'));
const lp = await login.newPage();
await lp.goto(BASE + '/login');
await lp.locator('input[type=email]').fill('owner@leadflow.test');
await lp.locator('input[type=password]').fill('LeadFlow-demo-1');
await lp.keyboard.press('Enter');
await lp.waitForURL(/\/b\//, { timeout: 20000 });
const home = lp.url();
const state = await login.storageState();
await login.close();

// 2. the recording
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  storageState: state,
  recordVideo: { dir: raw, size: { width: W, height: H } },
});
await ctx.addInitScript(() => {
  localStorage.setItem('leadflow.locale', 'he');
  localStorage.setItem('leadflow.tour.off', '1'); // no onboarding tour on camera
  localStorage.setItem('leadflow.helper.quiet', '1');
  const boot = () => {
    if (document.getElementById('__cur')) return;
    const st = document.createElement('style');
    st.textContent = `
      #__cur{position:fixed;left:0;top:0;width:34px;height:34px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);filter:drop-shadow(0 4px 6px rgba(0,0,0,.35))}
      #__rip{position:fixed;z-index:2147483646;pointer-events:none;width:60px;height:60px;margin:-30px 0 0 -30px;border-radius:50%;border:4px solid #2563eb;opacity:0}
      #__cap{position:fixed;z-index:2147483645;left:50%;bottom:44px;transform:translate(-50%,30px);opacity:0;transition:opacity .5s,transform .5s;background:rgba(15,23,42,.92);color:#fff;font:800 40px/1.2 Heebo,system-ui,sans-serif;padding:20px 44px;border-radius:999px;direction:rtl;white-space:nowrap;box-shadow:0 20px 50px -10px rgba(0,0,0,.5)}
      #__cap.on{opacity:1;transform:translate(-50%,0)}
      #__card{position:fixed;inset:0;z-index:2147483644;display:grid;place-items:center;background:linear-gradient(160deg,#2563eb,#1e3a8a);color:#fff;text-align:center;font-family:Heebo,system-ui,sans-serif;opacity:0;pointer-events:none;transition:opacity .7s}
      #__card.on{opacity:1}
      #__card b{display:block;font-size:130px;font-weight:800;letter-spacing:-.01em;direction:ltr}
      #__card span{display:block;font-size:54px;font-weight:700;margin-top:18px;opacity:.95}`;
    document.head.appendChild(st);
    const cur = document.createElement('div');
    cur.id = '__cur';
    cur.innerHTML =
      '<svg viewBox="0 0 24 24" width="34" height="34"><path d="M4 2l15 9-6.5 1.6L9 19z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.append(cur);
    for (const id of ['__rip', '__cap', '__card']) {
      const d = document.createElement('div');
      d.id = id;
      document.body.append(d);
    }
    window.__pos = window.__pos || { x: 800, y: 500 };
    cur.style.transform = `translate(${window.__pos.x}px,${window.__pos.y}px)`;
  };
  document.addEventListener('DOMContentLoaded', boot);
  window.__boot = boot;
  window.__cap = (t) => {
    boot();
    const c = document.getElementById('__cap');
    if (!t) return c.classList.remove('on');
    c.textContent = t;
    c.classList.add('on');
  };
  window.__card = (html) => {
    boot();
    const c = document.getElementById('__card');
    if (html) c.innerHTML = html;
    c.classList.toggle('on', !!html);
  };
  window.__move = (x, y, ms) =>
    new Promise((res) => {
      boot();
      const cur = document.getElementById('__cur');
      const a = { ...window.__pos };
      const t0 = performance.now();
      const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
      const step = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        const e = ease(p);
        window.__pos = { x: a.x + (x - a.x) * e, y: a.y + (y - a.y) * e };
        cur.style.transform = `translate(${window.__pos.x}px,${window.__pos.y}px)`;
        if (p < 1) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
    });
  window.__click = () => {
    const r = document.getElementById('__rip');
    r.style.left = window.__pos.x + 4 + 'px';
    r.style.top = window.__pos.y + 4 + 'px';
    r.animate(
      [
        { opacity: 0.9, transform: 'scale(.3)' },
        { opacity: 0, transform: 'scale(1.6)' },
      ],
      { duration: 600 },
    );
  };
});

const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const cap = (t) => page.evaluate((x) => window.__cap(x), t);
const card = (h) => page.evaluate((x) => window.__card(x), h);
const settle = async () => {
  await page.waitForLoadState('networkidle').catch(() => {});
  await wait(500);
};
/** Glides the cursor to the element, clicks it. */
const go = async (loc) => {
  const el = loc.first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const b = await el.boundingBox();
  if (!b) return false;
  await page.evaluate(
    ([x, y]) => window.__move(x, y, 900),
    [b.x + b.width / 2, b.y + b.height / 2],
  );
  await wait(150);
  await page.evaluate(() => window.__click());
  await el.click();
  return true;
};
const nav = (seg) => go(page.locator(`nav a[href$="/${seg}"]`));
const scrollBy = async (dy, ms = 1200) => {
  await page.evaluate(
    ([d, t]) =>
      new Promise((res) => {
        const el = document.querySelector('main') || document.scrollingElement;
        const s = el.scrollTop;
        const t0 = performance.now();
        const f = (n) => {
          const p = Math.min(1, (n - t0) / t);
          el.scrollTop = s + d * (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
          if (p < 1) requestAnimationFrame(f);
          else res();
        };
        requestAnimationFrame(f);
      }),
    [dy, ms],
  );
};

await page.goto(home);
await settle();
await card(
  '<div><b>Lead<span style="display:inline;font-size:inherit;color:#93c5fd;margin:0">Flow</span></b><span>הדגמה של המערכת</span></div>',
);
await wait(2300);
await card('');
await wait(800);

// dashboard
await cap('הדשבורד: מה קורה בעסק, היום');
await wait(3200);
await scrollBy(300);
await wait(1500);
await scrollBy(-300, 800);
await cap('');

// the site
await nav('site');
await settle();
await cap('אתר אישי לעסק, מוכן בדקות');
await wait(3600);

// leads, then one lead
await nav('leads');
await settle();
await cap('כל הפניות והלקוחות במקום אחד');
await wait(2600);
await go(page.locator('main a[href*="/leads/"]'));
await settle();
await cap('כל הפרטים, ההיסטוריה והשיחות של הלקוח');
await wait(2500);
await scrollBy(420, 1400);
await wait(1800);

// conversations
await nav('conversations');
await settle();
await cap('תיבת שיחות מאוחדת: וואטסאפ, מייל ועוד');
await wait(2000);
await go(page.locator('main button', { hasText: 'עומר גבאי' }));
await settle();
await cap('מענה ללקוחות ישר מהמערכת');
await wait(3600);

// automations
await nav('automations');
await settle();
await cap('מענה אוטומטי וקביעת תורים, גם כשאתם עסוקים');
await wait(3000);
await scrollBy(500, 1500);
await wait(1800);

// appointments
await nav('appointments');
await settle();
await cap('יומן תורים שמתמלא לבד');
await wait(3600);

// tasks
await nav('tasks');
await settle();
await cap('משימות ותזכורות לצוות');
await wait(1800);
await go(page.locator('main input[type="checkbox"], main [role="checkbox"]').first());
await wait(2200);

// quotes
await nav('quotes');
await settle();
await cap('הצעות מחיר ואישור דיגיטלי');
await wait(3000);

// reports
await nav('reports');
await settle();
await cap('דוחות וניתוחים: מה עובד ומאיפה מגיעים הלקוחות');
await wait(2200);
await scrollBy(450, 1500);
await wait(2000);
await cap('');

await card(
  '<div><b>Lead<span style="display:inline;font-size:inherit;color:#93c5fd;margin:0">Flow</span></b><span>העסק שלך על אוטומט.</span></div>',
);
await wait(3200);

await ctx.close();
await browser.close();

const file = readdirSync(raw).find((f) => f.endsWith('.webm'));
const mp4 = path.join(out, 'leadflow-demo-he.mp4');
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-i',
    path.join(raw, file),
    '-vf',
    'scale=1920:1080:flags=lanczos,fps=30',
    '-c:v',
    'libx264',
    '-crf',
    '17',
    '-preset',
    'slow',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    mp4,
  ],
  { stdio: 'ignore' },
);
rmSync(raw, { recursive: true, force: true });
console.log('wrote', mp4);
