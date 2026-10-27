import { formatIsraeliPhone, WEEKDAYS, weekdayLabels } from './business';
import { FORM_TOKEN_PLACEHOLDER, HONEYPOT_FIELD, LEAD_FORM_PATH } from './leads';
import { FONTS, PALETTES, type Section, type SiteTheme } from './site';
import type { SiteBusinessInfo, SiteDraft } from './site-templates';

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

function section(s: Section, b: SiteBusinessInfo, contactId: string | undefined): string {
  const id = `s-${esc(s.id)}`;
  switch (s.type) {
    case 'hero': {
      const href =
        s.buttonAction === 'call' && b.phone
          ? telHref(b.phone)
          : contactId
            ? `#s-${esc(contactId)}`
            : '';
      return `<header class="hero" id="${id}"><div class="wrap">
<h1>${esc(s.title)}</h1>${s.subtitle ? `<p class="lead">${esc(s.subtitle)}</p>` : ''}
${s.buttonLabel && href ? `<a class="btn" href="${href}">${esc(s.buttonLabel)}</a>` : ''}
</div></header>`;
    }
    case 'about':
      return `<section id="${id}"><div class="wrap narrow"><h2>${esc(s.title)}</h2>${paragraphs(s.body)}</div></section>`;
    case 'services':
      return `<section id="${id}" class="soft"><div class="wrap"><h2>${esc(s.title)}</h2><div class="grid">${s.items
        .map(
          (i) =>
            `<article class="card"><h3>${esc(i.name)}</h3>${i.description ? `<p>${esc(i.description)}</p>` : ''}</article>`,
        )
        .join('')}</div></div></section>`;
    case 'pricing':
      return `<section id="${id}"><div class="wrap narrow"><h2>${esc(s.title)}</h2><ul class="prices">${s.items
        .map(
          (i) =>
            `<li><span>${esc(i.name)}</span><span class="dots"></span><bdi>${esc(i.price)}</bdi></li>`,
        )
        .join('')}</ul>${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}</div></section>`;
    case 'testimonials':
      return `<section id="${id}" class="soft"><div class="wrap"><h2>${esc(s.title)}</h2><div class="grid">${s.items
        .filter((i) => i.quote)
        .map(
          (i) =>
            `<figure class="card quote"><blockquote>${esc(i.quote)}</blockquote>${i.author ? `<figcaption>— ${esc(i.author)}</figcaption>` : ''}</figure>`,
        )
        .join('')}</div></div></section>`;
    case 'faq':
      return `<section id="${id}"><div class="wrap narrow"><h2>${esc(s.title)}</h2>${s.items
        .filter((i) => i.question)
        .map(
          (i) => `<details><summary>${esc(i.question)}</summary><p>${esc(i.answer)}</p></details>`,
        )
        .join('')}</div></section>`;
    case 'contact': {
      const rows: string[] = [];
      if (s.showPhone && b.phone) {
        rows.push(
          `<li><span class="k">טלפון</span><a href="${telHref(b.phone)}"><bdi dir="ltr">${esc(formatIsraeliPhone(b.phone))}</bdi></a></li>`,
        );
      }
      if (s.showAddress && b.address) {
        rows.push(
          `<li><span class="k">כתובת</span><a href="${mapsHref(b.address)}" target="_blank" rel="noopener">${esc(b.address)}</a></li>`,
        );
      }
      const hours =
        s.showHours && b.openingHours
          ? `<table class="hours"><caption>שעות פעילות</caption>${WEEKDAYS.map((d) => {
              const h = b.openingHours?.[d];
              return `<tr><th scope="row">${weekdayLabels[d]}</th><td>${h?.open ? `<bdi dir="ltr">${esc(h.from)}–${esc(h.to)}</bdi>` : 'סגור'}</td></tr>`;
            }).join('')}</table>`
          : '';
      const form = s.form.enabled ? leadForm(s, b) : '';
      return `<section id="${id}" class="contact"><div class="wrap"><h2>${esc(s.title)}</h2>${s.subtitle ? `<p class="lead">${esc(s.subtitle)}</p>` : ''}
<div class="contact-grid"><div><ul class="info">${rows.join('')}</ul>${hours}</div>${form}</div></div></section>`;
    }
    case 'cta': {
      const href = b.phone ? telHref(b.phone) : contactId ? `#s-${esc(contactId)}` : '';
      return `<section id="${id}" class="cta"><div class="wrap"><h2>${esc(s.title)}</h2>${s.subtitle ? `<p>${esc(s.subtitle)}</p>` : ''}${s.buttonLabel && href ? `<a class="btn light" href="${href}">${esc(s.buttonLabel)}</a>` : ''}</div></section>`;
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${fontParam}:wght@400;500;700&display=swap">
<style>
:root{--p:${palette.primary};--a:${palette.accent};--soft:${palette.soft};--ink:#1f2933;--muted:#5f6b74}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font-family:'${font.family}',system-ui,Arial,sans-serif;color:var(--ink);line-height:1.65;background:#fff}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}.narrow{max-width:760px}
section{padding:64px 0}section.soft{background:var(--soft)}
h1,h2,h3{line-height:1.25;margin:0 0 .6em}h1{font-size:clamp(2rem,5vw,3.25rem)}h2{font-size:clamp(1.5rem,3.4vw,2.1rem);color:var(--p)}h3{font-size:1.15rem}
p{margin:0 0 1em}.lead{font-size:1.15rem;color:var(--muted);max-width:640px}
a{color:var(--p)}
.nav{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.92);backdrop-filter:blur(6px);border-bottom:1px solid #eee}
.nav .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;height:60px}
.brand{font-weight:700;font-size:1.1rem;color:var(--ink);text-decoration:none}
.nav .call{background:var(--p);color:#fff;text-decoration:none;border-radius:999px;padding:8px 16px;font-size:.95rem;white-space:nowrap}
.hero{padding:88px 0 80px;background:linear-gradient(160deg,var(--soft),#fff 70%);position:relative;overflow:hidden}
.hero::after{content:"";position:absolute;inset-inline-start:-120px;top:-120px;width:320px;height:320px;border-radius:50%;background:var(--a);opacity:.12}
.hero h1{color:var(--ink)}.hero .lead{margin-bottom:1.6em}
.btn{display:inline-block;background:var(--p);color:#fff;text-decoration:none;font-weight:500;padding:14px 28px;border-radius:999px;box-shadow:0 6px 20px -8px var(--p)}
.btn.light{background:#fff;color:var(--p);box-shadow:none}
.grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}
.card{background:#fff;border:1px solid #ece8e2;border-radius:18px;padding:22px;margin:0}
.card p{color:var(--muted);margin:0}
.quote blockquote{margin:0 0 .8em;font-size:1.05rem}.quote figcaption{color:var(--muted);font-size:.95rem}
.prices{list-style:none;margin:0;padding:0}.prices li{display:flex;align-items:baseline;gap:10px;padding:12px 0;border-bottom:1px solid #f0ece6}
.prices .dots{flex:1;border-bottom:2px dotted #ddd}.prices bdi{font-weight:700;color:var(--p)}.note{color:var(--muted);font-size:.95rem;margin-top:1em}
details{border:1px solid #ece8e2;border-radius:14px;padding:14px 18px;margin-bottom:12px}summary{cursor:pointer;font-weight:500}details p{margin:.6em 0 0;color:var(--muted)}
.contact-grid{display:grid;gap:28px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));align-items:start}
.info{list-style:none;margin:0;padding:0}.info li{display:flex;flex-direction:column;padding:10px 0}.k{font-size:.85rem;color:var(--muted)}.info a{font-size:1.15rem;text-decoration:none}
.hours{border-collapse:collapse;width:100%;background:var(--soft);border-radius:16px;overflow:hidden}.hours caption{text-align:start;font-weight:700;padding-bottom:8px}
.hours th,.hours td{padding:8px 16px;text-align:start;font-weight:400}.hours tr+tr{border-top:1px solid rgba(0,0,0,.05)}
.cta{background:var(--p);color:#fff;text-align:center}.cta h2{color:#fff}.cta p{opacity:.9}
footer{padding:28px 0;text-align:center;color:var(--muted);font-size:.9rem;border-top:1px solid #f0ece6}
.empty{padding:120px 20px;text-align:center;color:var(--muted)}
.lead-form{display:flex;flex-direction:column;gap:14px;background:#fff;border:1px solid #ece8e2;border-radius:20px;padding:24px;box-shadow:0 10px 30px -18px rgba(0,0,0,.25)}
.lead-form label{display:flex;flex-direction:column;gap:6px;font-size:.95rem;font-weight:500}
.lead-form input,.lead-form textarea{font:inherit;font-weight:400;padding:12px 14px;border:1px solid #ddd6cc;border-radius:12px;background:#fff;color:var(--ink)}
.lead-form input:focus,.lead-form textarea:focus{outline:2px solid var(--p);outline-offset:1px;border-color:var(--p)}
.lead-form .consent{flex-direction:row;align-items:flex-start;gap:10px;font-weight:400;color:var(--muted);font-size:.9rem}
.lead-form .consent input{margin-top:4px;width:18px;height:18px;accent-color:var(--p)}
.lead-form .btn{border:0;cursor:pointer;font:inherit;font-weight:500;align-self:flex-start}
.hp{position:absolute;inset-inline-start:-10000px;width:1px;height:1px;overflow:hidden}
.msg{max-width:560px;margin:0 auto;padding:96px 20px;text-align:center}.msg ul{text-align:start;color:var(--muted)}
@media (max-width:640px){section{padding:48px 0}.hero{padding:64px 0 56px}}
</style>
</head>`;
}

export function renderSitePage(draft: Omit<SiteDraft, 'templateKey'>, b: SiteBusinessInfo): string {
  const visible = draft.sections.filter((s) => s.visible);
  const contactId = visible.find((s) => s.type === 'contact')?.id;

  return `${documentHead(draft.theme, draft.seo.title || b.name, draft.seo.description)}
<body>
<nav class="nav"><div class="wrap"><a class="brand" href="#">${esc(b.name)}</a>${b.phone ? `<a class="call" href="${telHref(b.phone)}">חייגו: <bdi dir="ltr">${esc(formatIsraeliPhone(b.phone))}</bdi></a>` : ''}</div></nav>
<main>${visible.length ? visible.map((s) => section(s, b, contactId)).join('\n') : '<div class="empty">אין מקטעים מוצגים באתר.</div>'}</main>
<footer><div class="wrap">© ${esc(b.name)}</div></footer>
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
<nav class="nav"><div class="wrap"><a class="brand" href="/">${esc(b.name)}</a></div></nav>
<main class="msg"><h1>${esc(page.title)}</h1><p class="lead" style="margin-inline:auto">${esc(page.text)}</p>${
    page.items?.length ? `<ul>${page.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''
  }<p><a class="btn" href="/">${esc(page.backLabel)}</a></p></main>
</body>
</html>`;
}
