import { formatIsraeliPhone, industryLabels, WEEKDAYS, weekdayLabels } from './business';
import { FORM_TOKEN_PLACEHOLDER, HONEYPOT_FIELD, LEAD_FORM_PATH } from './leads';
import { FONTS, PALETTES, type Section, type SiteTheme } from './site';
import type { SiteBusinessInfo, SiteDraft } from './site-templates';

/** Resolved image for rendering (built by the server from the business's own assets). */
export interface MediaRef {
  url: string;
  width: number;
  height: number;
}
export type MediaMap = Record<string, MediaRef>;

const img = (m: MediaRef, alt: string, cls: string, lazy = true) =>
  `<img class="${cls}" src="${esc(m.url)}" alt="${esc(alt)}" width="${m.width}" height="${m.height}"${lazy ? ' loading="lazy" decoding="async"' : ''}>`;

/**
 * Renders a site draft to a complete, static, RTL HTML document.
 * Pure and dependency-free, shared by the editor preview (iframe srcdoc) and publishing (F06).
 *
 * Security: every user-provided string goes through `esc()`. URLs are never user-provided:
 * only `tel:` from a validated E.164 phone and a Google Maps search URL built with
 * encodeURIComponent. No scripts are emitted.
 */

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Escapes and keeps the owner's line breaks. */
const paragraphs = (s: string) =>
  s
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

const telHref = (e164: string) => `tel:${e164.replace(/[^+\d]/g, '')}`;
const mapsHref = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/**
 * Plain HTML lead form (no JavaScript on customer sites). Browser-side checks via HTML attributes;
 * the server validates again. The token placeholder is replaced per page view by the public server.
 */
function leadForm(s: Extract<Section, { type: 'contact' }>, b: SiteBusinessInfo): string {
  const f = s.form;
  return `<form class="lead-form" method="post" action="${LEAD_FORM_PATH}" aria-label="טופס יצירת קשר">
<input type="hidden" name="_t" value="${FORM_TOKEN_PLACEHOLDER}"><input type="hidden" name="_s" value="${esc(s.id)}">
<div class="hp" aria-hidden="true"><label>אתר אינטרנט<input name="${HONEYPOT_FIELD}" tabindex="-1" autocomplete="off"></label></div>
<label>שם מלא<input name="name" required minlength="2" maxlength="80" autocomplete="name"></label>
<label>טלפון<input name="phone" type="tel" required inputmode="tel" dir="ltr" maxlength="20" pattern="[0-9+()\\s\\-]{9,20}" title="מספר טלפון ישראלי, לדוגמה 050-1234567" autocomplete="tel"></label>
${f.askEmail ? '<label>אימייל (לא חובה)<input name="email" type="email" dir="ltr" maxlength="254" autocomplete="email"></label>' : ''}
${f.askMessage ? '<label>איך נוכל לעזור? (לא חובה)<textarea name="message" rows="4" maxlength="1000"></textarea></label>' : ''}
<label class="consent"><input type="checkbox" name="consent" required> אני מאשר/ת ש${esc(b.name)} יחזרו אליי בנוגע לפנייה זו.</label>
<button class="btn" type="submit">${esc(f.buttonLabel)}</button>
</form>`;
}

/** Small inline icons (decorative; stroke follows the text colour). */
const ICONS = {
  phone:
    '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chat: '<path d="M4 5h16v11H8l-4 4z"/>',
  arrow: '<path d="M19 12H5m6-6l-6 6 6 6"/>',
} as const;
const icon = (name: keyof typeof ICONS, cls = 'ic') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

/** Short labels for the header menu, by section type. */
const NAV_LABELS: Partial<Record<Section['type'], string>> = {
  services: 'שירותים',
  pricing: 'מחירון',
  about: 'אודות',
  gallery: 'גלריה',
  testimonials: 'המלצות',
  faq: 'שאלות נפוצות',
  contact: 'צור קשר',
};

/** "ראשון–חמישי 09:00–18:00" lines, grouping consecutive days with the same hours. */
export function hoursSummary(hours: SiteBusinessInfo['openingHours']): string[] {
  if (!hours) return [];
  const groups: { from: string; to: string; key: string }[] = [];
  for (const d of WEEKDAYS) {
    const h = hours[d];
    const key = h?.open ? `${h.from}–${h.to}` : 'סגור';
    const last = groups.at(-1);
    if (last && last.key === key) last.to = weekdayLabels[d];
    else groups.push({ from: weekdayLabels[d], to: weekdayLabels[d], key });
  }
  return groups
    .filter((g) => g.key !== 'סגור')
    .map((g) => `${g.from === g.to ? g.from : `${g.from}–${g.to}`} ${g.key}`);
}

interface Ctx {
  b: SiteBusinessInfo;
  contactId: string | undefined;
  media: MediaMap;
  testimonialCount: number;
}

const heading = (eyebrow: string | undefined, title: string, sub?: string) =>
  `<div class="head">${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}<h2>${esc(title)}</h2>${sub ? `<p class="lead">${esc(sub)}</p>` : ''}</div>`;

/** Hours line with times kept left-to-right. */
const hoursHtml = (line: string) => {
  const i = line.search(/\d/);
  return i < 0 ? esc(line) : `${esc(line.slice(0, i))}<bdi dir="ltr">${esc(line.slice(i))}</bdi>`;
};

function hero(s: Extract<Section, { type: 'hero' }>, id: string, c: Ctx): string {
  const { b, contactId } = c;
  const call = b.phone ? telHref(b.phone) : '';
  const toContact = contactId ? `#s-${esc(contactId)}` : '';
  const primaryHref = s.buttonAction === 'call' && call ? call : toContact;
  // The second button offers the other way to reach the business.
  const secondary =
    primaryHref === call && toContact
      ? `<a class="btn ghost" href="${toContact}">${icon('chat')}השארת פרטים</a>`
      : primaryHref !== call && call
        ? `<a class="btn ghost" href="${call}">${icon('phone')}<bdi dir="ltr">${esc(formatIsraeliPhone(b.phone!))}</bdi></a>`
        : '';
  const chips = [
    b.serviceAreas.length ? `${icon('pin')}${esc(b.serviceAreas.slice(0, 3).join(' · '))}` : '',
    c.testimonialCount >= 2 ? `${icon('chat')}${c.testimonialCount} לקוחות ממליצים` : '',
    hoursSummary(b.openingHours).length
      ? `${icon('clock')}${hoursHtml(hoursSummary(b.openingHours)[0]!)}`
      : '',
  ].filter(Boolean);
  // Short form for the badge: "בעלי מקצוע (חשמל, ...)" → "בעלי מקצוע".
  const industry = (industryLabels as Record<string, string>)[b.industry]?.replace(
    /\s*\(.*\)\s*$/,
    '',
  );
  const bg = s.imageAssetId ? c.media[s.imageAssetId] : undefined;

  const text = `<div class="hero-text">${industry ? `<span class="eyebrow">${esc(industry)}</span>` : ''}
<h1>${esc(s.title)}</h1>${s.subtitle ? `<p class="lead">${esc(s.subtitle)}</p>` : ''}
<div class="actions">${s.buttonLabel && primaryHref ? `<a class="btn" href="${primaryHref}">${esc(s.buttonLabel)}${icon('arrow')}</a>` : ''}${secondary}</div>
${chips.length ? `<ul class="chips">${chips.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}</div>`;

  if (bg) {
    return `<header class="hero has-img" id="${id}">${img(bg, '', 'hero-bg', false)}<div class="wrap">${text}</div></header>`;
  }
  // No photo: a "business card" with the real contact details balances the layout.
  const rows = [
    b.phone
      ? `<li>${icon('phone')}<div><span class="k">טלפון</span><a href="${call}"><bdi dir="ltr">${esc(formatIsraeliPhone(b.phone))}</bdi></a></div></li>`
      : '',
    b.address
      ? `<li>${icon('pin')}<div><span class="k">כתובת</span><span>${esc(b.address)}</span></div></li>`
      : '',
    hoursSummary(b.openingHours).length
      ? `<li>${icon('clock')}<div><span class="k">שעות פעילות</span>${hoursSummary(b.openingHours)
          .map((l) => `<span>${hoursHtml(l)}</span>`)
          .join('')}</div></li>`
      : '',
  ].filter(Boolean);
  return `<header class="hero" id="${id}"><div class="wrap hero-grid">${text}${
    rows.length
      ? `<aside class="biz-card" aria-label="פרטי העסק"><p class="biz-name">${esc(b.name)}</p><ul>${rows.join('')}</ul>${
          toContact
            ? `<a class="card-link" href="${toContact}">השאירו פרטים ונחזור אליכם ${icon('arrow')}</a>`
            : ''
        }</aside>`
      : ''
  }</div></header>`;
}

function section(s: Section, c: Ctx, alt: boolean): string {
  const { b, contactId, media } = c;
  const id = `s-${esc(s.id)}`;
  const cls = alt ? ' class="soft"' : '';
  switch (s.type) {
    case 'hero':
      return hero(s, id, c);
    case 'about': {
      const pic = s.imageAssetId ? media[s.imageAssetId] : undefined;
      return pic
        ? `<section id="${id}"${cls}><div class="wrap about-grid"><div class="about-text">${heading('אודות', s.title)}${paragraphs(s.body)}</div><div class="about-media">${img(pic, s.imageAlt, 'about-img')}</div></div></section>`
        : `<section id="${id}"${cls}><div class="wrap narrow about-solo">${heading('אודות', s.title)}<div class="about-body">${paragraphs(s.body)}</div></div></section>`;
    }
    case 'gallery': {
      const pics = s.items.filter((i) => media[i.assetId]);
      if (pics.length === 0) return '';
      return `<section id="${id}"${cls}><div class="wrap">${heading('גלריה', s.title)}<div class="gallery">${pics
        .map(
          (i) =>
            `<figure>${img(media[i.assetId]!, i.caption, 'gallery-img')}${i.caption ? `<figcaption>${esc(i.caption)}</figcaption>` : ''}</figure>`,
        )
        .join('')}</div></div></section>`;
    }
    case 'services':
      return `<section id="${id}"${cls}><div class="wrap">${heading('שירותים', s.title)}<div class="grid services">${s.items
        .map(
          (i, n) =>
            `<article class="card service"><span class="tile">${icon('check')}</span><span class="num" aria-hidden="true">${String(n + 1).padStart(2, '0')}</span><h3>${esc(i.name)}</h3>${i.description ? `<p>${esc(i.description)}</p>` : ''}</article>`,
        )
        .join('')}</div></div></section>`;
    case 'pricing':
      return `<section id="${id}"${cls}><div class="wrap narrow">${heading('מחירון', s.title)}<div class="card price-card"><ul class="prices">${s.items
        .map(
          (i) =>
            `<li><span>${esc(i.name)}</span><span class="dots"></span><bdi>${esc(i.price)}</bdi></li>`,
        )
        .join('')}</ul>${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}</div></div></section>`;
    case 'testimonials': {
      const items = s.items.filter((i) => i.quote);
      if (items.length === 0) return '';
      return `<section id="${id}"${cls}><div class="wrap">${heading('המלצות', s.title)}<div class="grid">${items
        .map(
          (i) =>
            `<figure class="card quote"><span class="qmark" aria-hidden="true">”</span><blockquote>${esc(i.quote)}</blockquote>${
              i.author
                ? `<figcaption><span class="avatar" aria-hidden="true">${esc(i.author.trim().charAt(0))}</span>${esc(i.author)}</figcaption>`
                : ''
            }</figure>`,
        )
        .join('')}</div></div></section>`;
    }
    case 'faq':
      return `<section id="${id}"${cls}><div class="wrap narrow">${heading('שאלות נפוצות', s.title)}<div class="faq">${s.items
        .filter((i) => i.question)
        .map(
          (i, n) =>
            `<details${n === 0 ? ' open' : ''}><summary>${esc(i.question)}</summary><p>${esc(i.answer)}</p></details>`,
        )
        .join('')}</div></div></section>`;
    case 'contact': {
      const rows: string[] = [];
      if (s.showPhone && b.phone) {
        rows.push(
          `<li>${icon('phone')}<div><span class="k">טלפון</span><a href="${telHref(b.phone)}"><bdi dir="ltr">${esc(formatIsraeliPhone(b.phone))}</bdi></a></div></li>`,
        );
      }
      if (s.showAddress && b.address) {
        rows.push(
          `<li>${icon('pin')}<div><span class="k">כתובת</span><a href="${mapsHref(b.address)}" target="_blank" rel="noopener">${esc(b.address)}</a></div></li>`,
        );
      }
      if (b.serviceAreas.length) {
        rows.push(
          `<li>${icon('check')}<div><span class="k">אזורי שירות</span><span>${esc(b.serviceAreas.join(', '))}</span></div></li>`,
        );
      }
      const hours =
        s.showHours && b.openingHours
          ? `<table class="hours"><caption>שעות פעילות</caption>${WEEKDAYS.map((d) => {
              const h = b.openingHours?.[d];
              return `<tr><th scope="row">${weekdayLabels[d]}</th><td>${h?.open ? `<bdi dir="ltr">${esc(h.from)}–${esc(h.to)}</bdi>` : '<span class="closed">סגור</span>'}</td></tr>`;
            }).join('')}</table>`
          : '';
      const form = s.form.enabled ? `<div class="form-wrap">${leadForm(s, b)}</div>` : '';
      return `<section id="${id}" class="contact${alt ? ' soft' : ''}"><div class="wrap">${heading('צור קשר', s.title, s.subtitle || undefined)}
<div class="contact-grid"><div class="contact-info">${rows.length ? `<ul class="info">${rows.join('')}</ul>` : ''}${hours}</div>${form}</div></div></section>`;
    }
    case 'cta': {
      const href = b.phone ? telHref(b.phone) : contactId ? `#s-${esc(contactId)}` : '';
      return `<section id="${id}" class="cta-wrap"><div class="wrap"><div class="cta"><div><h2>${esc(s.title)}</h2>${s.subtitle ? `<p>${esc(s.subtitle)}</p>` : ''}</div>${s.buttonLabel && href ? `<a class="btn light" href="${href}">${b.phone ? icon('phone') : ''}${esc(s.buttonLabel)}</a>` : ''}</div></div></section>`;
    }
  }
}

function documentHead(theme: SiteTheme, title: string, description: string, noindex = false) {
  const palette = PALETTES[theme.palette];
  const font = FONTS[theme.font];
  const fontParam = encodeURIComponent(font.family).replace(/%20/g, '+');
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${noindex ? '<meta name="robots" content="noindex">' : ''}
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta name="theme-color" content="${palette.primary}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${fontParam}:wght@400;500;700;800&display=swap">
<style>${css(palette, font.family)}</style>
</head>`;
}

function css(palette: (typeof PALETTES)[keyof typeof PALETTES], family: string) {
  return `
:root{--p:${palette.primary};--a:${palette.accent};--soft:${palette.soft};--pd:color-mix(in srgb,var(--p) 78%,#000);--ink:#18202a;--muted:#5b6672;--line:#e8e4de;--r:22px;--sh:0 1px 2px rgba(20,24,31,.04),0 12px 32px -14px rgba(20,24,31,.18)}
*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;font-family:'${family}',system-ui,Arial,sans-serif;color:var(--ink);line-height:1.7;background:#fff;font-size:17px}
img{max-width:100%}
.wrap{max-width:1160px;margin:0 auto;padding:0 22px}.narrow{max-width:800px}
section{padding:88px 0;scroll-margin-top:72px}section.soft{background:var(--soft)}
h1,h2,h3{line-height:1.2;margin:0 0 .5em;letter-spacing:-.01em}
h1{font-size:clamp(2.2rem,5.4vw,3.9rem);font-weight:800}h2{font-size:clamp(1.7rem,3.6vw,2.5rem);font-weight:800}h3{font-size:1.2rem;font-weight:700}
p{margin:0 0 1em}.lead{font-size:1.15rem;color:var(--muted);max-width:620px}
a{color:var(--p)}
.ic{width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
:focus-visible{outline:3px solid var(--a);outline-offset:2px}
.head{margin-bottom:40px;max-width:680px}.head .lead{margin-top:-.2em}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:.85rem;font-weight:700;color:var(--p);background:color-mix(in srgb,var(--p) 9%,#fff);padding:5px 14px;border-radius:999px;margin-bottom:14px}
.eyebrow::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--a)}
/* Header */
.nav{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.9);backdrop-filter:saturate(1.6) blur(10px);-webkit-backdrop-filter:saturate(1.6) blur(10px);border-bottom:1px solid rgba(0,0,0,.06)}
.nav .wrap{display:flex;align-items:center;gap:20px;height:70px}
.brand{display:inline-flex;align-items:center;gap:10px;font-weight:800;font-size:1.15rem;color:var(--ink);text-decoration:none;margin-inline-end:auto}
.logo{height:42px;width:auto;max-width:150px;object-fit:contain}
.mark{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:12px;background:var(--p);color:#fff;font-size:1.05rem}
.menu{display:flex;gap:4px;list-style:none;margin:0;padding:0}
.menu a{display:block;padding:8px 12px;border-radius:10px;color:var(--ink);text-decoration:none;font-size:.95rem;font-weight:500}
.menu a:hover{background:var(--soft);color:var(--p)}
.call{display:inline-flex;align-items:center;gap:8px;background:var(--p);color:#fff;text-decoration:none;border-radius:999px;padding:9px 18px;font-weight:700;font-size:.95rem;white-space:nowrap}
.call:hover{background:var(--pd)}
/* Buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:var(--p);color:#fff;text-decoration:none;font-weight:700;padding:15px 28px;border-radius:999px;border:2px solid var(--p);box-shadow:0 10px 24px -12px var(--p);transition:transform .15s,background .15s}
.btn:hover{background:var(--pd);border-color:var(--pd);transform:translateY(-1px)}
.btn .ic{width:18px;height:18px}
.btn.ghost{background:#fff;color:var(--ink);border-color:var(--line);box-shadow:none}.btn.ghost:hover{border-color:var(--p);color:var(--p);background:#fff}
.btn.light{background:#fff;color:var(--p);border-color:#fff;box-shadow:none}.btn.light:hover{background:var(--soft);border-color:var(--soft)}
/* Hero */
.hero{position:relative;overflow:hidden;padding:96px 0 104px;background:radial-gradient(1200px 500px at 85% -10%,color-mix(in srgb,var(--a) 16%,transparent),transparent 60%),radial-gradient(900px 500px at 0% 110%,color-mix(in srgb,var(--p) 12%,transparent),transparent 60%),linear-gradient(180deg,var(--soft),#fff)}
.hero-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,.85fr);gap:56px;align-items:center}
.hero .lead{font-size:1.25rem;margin-bottom:1.8em}
.actions{display:flex;flex-wrap:wrap;gap:12px}
.chips{display:flex;flex-wrap:wrap;gap:10px 22px;list-style:none;margin:30px 0 0;padding:0;color:var(--muted);font-size:.95rem}
.chips li{display:inline-flex;align-items:center;gap:8px}.chips .ic{color:var(--p);width:18px;height:18px}
.biz-card{background:#fff;border:1px solid var(--line);border-radius:28px;padding:30px;box-shadow:0 30px 60px -30px rgba(20,24,31,.35);position:relative}
.biz-card::before{content:"";position:absolute;inset-inline-end:-14px;top:-14px;width:90px;height:90px;border-radius:24px;background:var(--a);opacity:.18;z-index:-1}
.biz-name{font-weight:800;font-size:1.3rem;margin:0 0 18px;padding-bottom:16px;border-bottom:1px solid var(--line)}
.biz-card ul,.info{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:18px}
.biz-card li,.info li{display:flex;gap:14px;align-items:flex-start}
.biz-card li>.ic,.info li>.ic{width:42px;height:42px;padding:10px;border-radius:14px;background:var(--soft);color:var(--p)}
.biz-card li div,.info li div{display:flex;flex-direction:column}
.k{font-size:.82rem;color:var(--muted);font-weight:500}
.biz-card a,.info a{color:var(--ink);font-weight:700;text-decoration:none;font-size:1.08rem}.biz-card a:hover,.info a:hover{color:var(--p)}
.card-link{display:flex!important;align-items:center;justify-content:space-between;margin-top:22px;padding:14px 18px;border-radius:16px;background:var(--soft);color:var(--p)!important;font-size:1rem!important}
.hero.has-img{min-height:min(640px,82vh);display:flex;align-items:center;background:#111;color:#fff}
.hero-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero.has-img::before{content:"";position:absolute;inset:0;background:linear-gradient(270deg,rgba(10,12,16,.82),rgba(10,12,16,.45) 60%,rgba(10,12,16,.2));z-index:1}
.hero.has-img .wrap{position:relative;z-index:2;width:100%}.hero.has-img .hero-text{max-width:640px}
.hero.has-img .lead,.hero.has-img .chips{color:rgba(255,255,255,.88)}.hero.has-img .chips .ic{color:#fff}
.hero.has-img .eyebrow{background:rgba(255,255,255,.14);color:#fff}
.hero.has-img .btn.ghost{background:rgba(255,255,255,.1);color:#fff;border-color:rgba(255,255,255,.5)}
/* Cards & grids */
.grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.card{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:28px;margin:0;box-shadow:var(--sh)}
.card p{color:var(--muted);margin:0}
.service{position:relative;transition:transform .2s,box-shadow .2s}.service:hover{transform:translateY(-4px);box-shadow:0 24px 48px -24px rgba(20,24,31,.3)}
.tile{display:inline-flex;width:52px;height:52px;border-radius:16px;align-items:center;justify-content:center;background:var(--p);color:#fff;margin-bottom:18px}
.tile .ic{width:24px;height:24px;stroke-width:2.4}
.num{position:absolute;inset-inline-end:24px;top:22px;font-weight:800;font-size:1.6rem;color:var(--line)}
.price-card{padding:12px 32px}
.prices{list-style:none;margin:0;padding:0}.prices li{display:flex;align-items:baseline;gap:12px;padding:18px 0;border-bottom:1px solid var(--line);font-weight:500}.prices li:last-child{border-bottom:0}
.prices .dots{flex:1;border-bottom:2px dotted #d8d2c8}.prices bdi{font-weight:800;color:var(--p);font-size:1.1rem}
.note{color:var(--muted);font-size:.95rem;margin:20px 0 0;text-align:center}
.quote{display:flex;flex-direction:column}.qmark{font-family:Georgia,'Times New Roman',serif;font-size:4rem;line-height:.8;height:.5em;color:var(--a);margin-bottom:18px}
.quote blockquote{margin:0 0 22px;font-size:1.08rem;line-height:1.75;flex:1}
.quote figcaption{display:flex;align-items:center;gap:12px;font-weight:700}
.avatar{display:inline-flex;width:40px;height:40px;border-radius:50%;align-items:center;justify-content:center;background:var(--soft);color:var(--p);font-weight:800}
.faq{display:flex;flex-direction:column;gap:12px}
details{background:#fff;border:1px solid var(--line);border-radius:18px;padding:0 24px;transition:box-shadow .2s}details[open]{box-shadow:var(--sh)}
summary{cursor:pointer;font-weight:700;list-style:none;padding:20px 0;display:flex;justify-content:space-between;gap:16px;align-items:center}
summary::-webkit-details-marker{display:none}
summary::after{content:"+";flex:none;width:30px;height:30px;border-radius:50%;background:var(--soft);color:var(--p);display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:500;line-height:1}
details[open] summary::after{content:"−"}details p{margin:0 0 20px;color:var(--muted)}
.about-grid{display:grid;gap:56px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:center}
.about-text p,.about-body p{color:#3a4450;font-size:1.08rem}
.about-media{position:relative}.about-media::after{content:"";position:absolute;inset:18px -18px -18px 18px;border-radius:28px;background:var(--soft);z-index:-1}
.about-img{width:100%;height:auto;border-radius:28px;object-fit:cover;display:block;box-shadow:var(--sh)}
.about-solo .head{text-align:center;margin-inline:auto}.about-body{border-inline-start:4px solid var(--a);padding-inline-start:24px}
.gallery{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.gallery figure{margin:0;overflow:hidden;border-radius:20px;background:#fff;box-shadow:var(--sh)}
.gallery-img{width:100%;height:260px;object-fit:cover;display:block;transition:transform .4s}.gallery figure:hover .gallery-img{transform:scale(1.04)}
.gallery figcaption{font-size:.92rem;color:var(--muted);padding:12px 16px}
/* CTA */
.cta-wrap{padding:24px 0 88px}
.cta{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:24px;padding:48px;border-radius:32px;color:#fff;background:radial-gradient(600px 300px at 0% 0%,color-mix(in srgb,var(--a) 45%,transparent),transparent 70%),linear-gradient(135deg,var(--p),var(--pd))}
.cta h2{color:#fff;margin:0 0 .3em}.cta p{margin:0;opacity:.9;font-size:1.1rem}
/* Contact */
.contact-grid{display:grid;gap:40px;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);align-items:start}
.contact-info{display:flex;flex-direction:column;gap:28px}
.hours{border-collapse:collapse;width:100%;background:#fff;border:1px solid var(--line);border-radius:20px;overflow:hidden;font-size:.97rem}
.hours caption{text-align:start;font-weight:800;padding-bottom:10px;font-size:1.05rem}
.hours th,.hours td{padding:11px 20px;text-align:start;font-weight:500}.hours td{text-align:end}.hours tr+tr{border-top:1px solid var(--line)}.closed{color:var(--muted)}
.lead-form{display:flex;flex-direction:column;gap:16px;background:#fff;border:1px solid var(--line);border-radius:28px;padding:32px;box-shadow:0 30px 60px -30px rgba(20,24,31,.3)}
.lead-form label{display:flex;flex-direction:column;gap:7px;font-size:.95rem;font-weight:700}
.lead-form input,.lead-form textarea{font:inherit;font-weight:400;padding:13px 16px;border:1.5px solid var(--line);border-radius:14px;background:#fbfaf8;color:var(--ink);transition:border-color .15s,background .15s}
.lead-form input:focus,.lead-form textarea:focus{outline:none;border-color:var(--p);background:#fff;box-shadow:0 0 0 4px color-mix(in srgb,var(--p) 15%,transparent)}
.lead-form .consent{flex-direction:row;align-items:flex-start;gap:10px;font-weight:400;color:var(--muted);font-size:.9rem}
.lead-form .consent input{margin-top:4px;width:18px;height:18px;accent-color:var(--p)}
.lead-form .btn{cursor:pointer;font:inherit;font-weight:700;width:100%}
.hp{position:absolute;inset-inline-start:-10000px;width:1px;height:1px;overflow:hidden}
/* Footer */
footer{background:#14181f;color:rgba(255,255,255,.72);padding:64px 0 0;font-size:.95rem}
.foot{display:grid;gap:36px;grid-template-columns:minmax(0,1.4fr) repeat(2,minmax(0,1fr));padding-bottom:44px}
footer h3{color:#fff;font-size:1rem;margin:0 0 14px}footer .brand{color:#fff;margin-bottom:12px}footer p{margin:0;max-width:360px}
footer ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}footer a{color:#fff;text-decoration:none}footer a:hover{text-decoration:underline}
.bottom{border-top:1px solid rgba(255,255,255,.1);padding:18px 0;font-size:.85rem;color:rgba(255,255,255,.5)}
/* Mobile call bar */
.mbar{display:none}
.empty{padding:120px 20px;text-align:center;color:var(--muted)}
.msg{max-width:560px;margin:0 auto;padding:96px 20px;text-align:center}.msg ul{text-align:start;color:var(--muted)}
@media (max-width:960px){.menu{display:none}.hero-grid,.contact-grid{grid-template-columns:1fr}.hero-grid{gap:40px}.foot{grid-template-columns:1fr 1fr}.foot>div:first-child{grid-column:1/-1}}
@media (max-width:640px){
body{font-size:16px}section{padding:60px 0}.hero{padding:56px 0 64px}.head{margin-bottom:28px}
.nav .wrap{height:62px}.call .num-text{display:none}.call{padding:9px 14px}
.actions .btn{flex:1 1 100%}.cta{padding:32px 24px}.cta .btn{width:100%}.price-card{padding:6px 20px}.lead-form{padding:22px}.card{padding:22px}
.foot{grid-template-columns:1fr}.biz-card{display:none}
.mbar{display:flex;gap:10px;position:fixed;inset-inline:0;bottom:0;z-index:30;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:rgba(255,255,255,.96);border-top:1px solid var(--line);box-shadow:0 -8px 24px -16px rgba(0,0,0,.3)}
.mbar a{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px;border-radius:14px;font-weight:700;text-decoration:none;background:var(--p);color:#fff}
.mbar a.alt{background:var(--soft);color:var(--p)}
body.has-mbar{padding-bottom:78px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
`;
}

export function renderSitePage(
  draft: Omit<SiteDraft, 'templateKey'>,
  b: SiteBusinessInfo,
  media: MediaMap = {},
): string {
  const logo = draft.theme.logoAssetId ? media[draft.theme.logoAssetId] : undefined;
  const visible = draft.sections.filter((s) => s.visible);
  const contactId = visible.find((s) => s.type === 'contact')?.id;
  const testimonialCount = visible
    .filter((s) => s.type === 'testimonials')
    .reduce(
      (n, s) => n + (s.type === 'testimonials' ? s.items.filter((i) => i.quote).length : 0),
      0,
    );
  const ctx: Ctx = { b, contactId, media, testimonialCount };

  // Header menu: the first section of each type that has a short label.
  const seen = new Set<string>();
  const menu = visible
    .filter((s) => NAV_LABELS[s.type] && !seen.has(s.type) && seen.add(s.type))
    .filter((s) => s.type !== 'gallery' || s.items.some((i) => media[i.assetId]))
    .slice(0, 6)
    .map((s) => `<li><a href="#s-${esc(s.id)}">${NAV_LABELS[s.type]}</a></li>`)
    .join('');

  // Alternate soft backgrounds between content sections (hero and CTA have their own look).
  let n = 0;
  const html = visible
    .map((s) =>
      s.type === 'hero' || s.type === 'cta'
        ? section(s, ctx, false)
        : section(s, ctx, n++ % 2 === 1),
    )
    .join('\n');

  const call = b.phone ? telHref(b.phone) : '';
  const mbar =
    call || contactId
      ? `<div class="mbar">${call ? `<a href="${call}">${icon('phone')}חייגו עכשיו</a>` : ''}${contactId ? `<a${call ? ' class="alt"' : ''} href="#s-${esc(contactId)}">${icon('chat')}השארת פרטים</a>` : ''}</div>`
      : '';
  const hours = hoursSummary(b.openingHours);
  const brand = `${logo ? img(logo, b.name, 'logo', false) : `<span class="mark" aria-hidden="true">${esc(b.name.trim().charAt(0))}</span>`}<span>${esc(b.name)}</span>`;

  return `${documentHead(draft.theme, draft.seo.title || b.name, draft.seo.description)}
<body${mbar ? ' class="has-mbar"' : ''}>
<nav class="nav" aria-label="ראשי"><div class="wrap"><a class="brand" href="#">${brand}</a>${menu ? `<ul class="menu">${menu}</ul>` : ''}${call ? `<a class="call" href="${call}">${icon('phone')}<span class="num-text"><bdi dir="ltr">${esc(formatIsraeliPhone(b.phone!))}</bdi></span></a>` : ''}</div></nav>
<main>${html || '<div class="empty">אין מקטעים מוצגים באתר.</div>'}</main>
<footer><div class="wrap foot"><div><a class="brand" href="#">${esc(b.name)}</a>${draft.seo.description ? `<p>${esc(draft.seo.description)}</p>` : ''}</div>
${call || b.address ? `<div><h3>יצירת קשר</h3><ul>${call ? `<li><a href="${call}"><bdi dir="ltr">${esc(formatIsraeliPhone(b.phone!))}</bdi></a></li>` : ''}${b.address ? `<li><a href="${mapsHref(b.address)}" target="_blank" rel="noopener">${esc(b.address)}</a></li>` : ''}</ul></div>` : ''}
${hours.length ? `<div><h3>שעות פעילות</h3><ul>${hours.map((l) => `<li>${hoursHtml(l)}</li>`).join('')}</ul></div>` : ''}</div>
<div class="bottom"><div class="wrap">© ${esc(b.name)} · האתר נבנה ב-LeadFlow</div></div></footer>
${mbar}
</body>
</html>`;
}

/** Small result page in the site's own look (thank-you, or "please fix" with the errors). */
export function renderSiteMessagePage(
  theme: SiteTheme,
  b: Pick<SiteBusinessInfo, 'name'>,
  page: { title: string; text: string; items?: string[]; backLabel: string },
): string {
  return `${documentHead(theme, `${page.title} · ${b.name}`, '', true)}
<body>
<nav class="nav"><div class="wrap"><a class="brand" href="/"><span class="mark" aria-hidden="true">${esc(b.name.trim().charAt(0))}</span><span>${esc(b.name)}</span></a></div></nav>
<main class="msg"><h1>${esc(page.title)}</h1><p class="lead" style="margin-inline:auto">${esc(page.text)}</p>${
    page.items?.length ? `<ul>${page.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''
  }<p><a class="btn" href="/">${esc(page.backLabel)}</a></p></main>
</body>
</html>`;
}
