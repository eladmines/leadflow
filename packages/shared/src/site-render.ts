import { formatIsraeliPhone, WEEKDAYS } from './business';
import { FORM_TOKEN_PLACEHOLDER, HONEYPOT_FIELD, LEAD_FORM_PATH } from './leads';
import {
  FONTS,
  resolvePalette,
  SECTION_TYPES,
  SITE_LIMITS,
  type Section,
  type SiteLanguage,
  type SiteTheme,
} from './site';
import { fill, siteText, type SiteText } from './site-i18n';
import type { SiteBusinessInfo, SiteDraft } from './site-templates';

/** Resolved image for rendering (built by the server from the business's own assets). */
export interface MediaRef {
  url: string;
  width: number;
  height: number;
}
export type MediaMap = Record<string, MediaRef>;

const img = (m: MediaRef, alt: string, cls: string, lazy = true, extra = '') =>
  `<img class="${cls}" src="${esc(m.url)}" alt="${esc(alt)}" width="${m.width}" height="${m.height}"${lazy ? ' loading="lazy" decoding="async"' : ''}${extra}>`;

/**
 * Renders a site draft to a complete, static HTML document, in the site's language and direction.
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
/** F17: optional appointment request (confirmed by the business afterwards). */
function appointmentFields(b: SiteBusinessInfo, L: SiteText): string {
  const services = b.services ?? [];
  return `<fieldset class="slot"><legend>${L.form.slot}</legend>${
    services.length
      ? `<label>${L.form.service}<select name="serviceId"><option value="">${L.form.chooseService}</option>${services
          .map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`)
          .join('')}</select></label>`
      : ''
  }<div class="slot-row"><label>${L.form.date}<input name="date" type="date"></label><label>${L.form.time}<input name="time" type="time" step="900"></label></div><p class="slot-note">${L.form.slotNote}</p></fieldset>`;
}

function leadForm(
  s: Extract<Section, { type: 'contact' }>,
  b: SiteBusinessInfo,
  pageSlug: string,
  L: SiteText,
): string {
  const f = s.form;
  return `<form class="lead-form" method="post" action="${LEAD_FORM_PATH}" aria-label="${L.form.label}">
<input type="hidden" name="_t" value="${FORM_TOKEN_PLACEHOLDER}"><input type="hidden" name="_s" value="${esc(s.id)}"><input type="hidden" name="_p" value="${esc(pageSlug)}">
<div class="hp" aria-hidden="true"><label>${L.form.website}<input name="${HONEYPOT_FIELD}" tabindex="-1" autocomplete="off"></label></div>
<label>${L.form.name}<input name="name" required minlength="2" maxlength="80" autocomplete="name"></label>
<label>${L.form.phone}<input name="phone" type="tel" required inputmode="tel" dir="ltr" maxlength="20" pattern="[0-9+()\\s\\-]{9,20}" title="${L.form.phoneHint}" autocomplete="tel"></label>
${f.askEmail ? `<label>${L.form.email}<input name="email" type="email" dir="ltr" maxlength="254" autocomplete="email"></label>` : ''}
${f.askMessage ? `<label>${L.form.message}<textarea name="message" rows="4" maxlength="1000"></textarea></label>` : ''}
${f.askAppointment ? appointmentFields(b, L) : ''}
<label class="consent"><input type="checkbox" name="consent" required> ${esc(fill(L.form.consent, b.name))}</label>
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
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
} as const;
const icon = (name: keyof typeof ICONS, cls = 'ic') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

/** "ראשון–חמישי 09:00–18:00" lines, grouping consecutive days with the same hours. */
export function hoursSummary(
  hours: SiteBusinessInfo['openingHours'],
  lang?: SiteLanguage,
): string[] {
  if (!hours) return [];
  const days = siteText(lang).weekdays;
  const groups: { from: string; to: string; key: string }[] = [];
  for (const d of WEEKDAYS) {
    const h = hours[d];
    const key = h?.open ? `${h.from}–${h.to}` : 'סגור';
    const last = groups.at(-1);
    if (last && last.key === key) last.to = days[d];
    else groups.push({ from: days[d], to: days[d], key });
  }
  return groups
    .filter((g) => g.key !== 'סגור')
    .map((g) => `${g.from === g.to ? g.from : `${g.from}–${g.to}`} ${g.key}`);
}

interface Ctx {
  b: SiteBusinessInfo;
  /** Link to the contact form: on this page, or on the home page (D-081); '' = none. */
  contactHref: string;
  /** Current page address ('' = home), posted with the lead form. */
  pageSlug: string;
  media: MediaMap;
  testimonialCount: number;
  /** Editor preview: mark which draft field each text/image shows (D-071). */
  editor: boolean;
  /** Wording of fixed buttons (D-075). */
  labels: NonNullable<SiteTheme['labels']>;
  /** The site's fixed texts, in its language (D-142). */
  lang: SiteLanguage | undefined;
  L: SiteText;
}

/** Marks business details (phone, address, hours, areas) in the editor: they are edited in the
 *  business profile, not in the site, so the editor opens a small dialog for them (D-075). */
const eb = (c: Ctx, kind: 'phone' | 'address' | 'hours' | 'areas') =>
  c.editor ? ` data-biz="${kind}" title="${c.L.editor.bizHint}"` : '';
/** The section's short name: menu item and the label above its title. */
const navLabel = (s: Section, c: Ctx) => s.navLabel || c.L.nav[s.type] || '';

/** Editor-only attribute naming the draft field an element shows. Never in published HTML. */
const ea = (c: Ctx, sid: string, path: string, multi = false, ph = '') =>
  c.editor
    ? ` data-edit="${esc(sid)}:${path}"${multi ? ' data-multi' : ''}${ph ? ` data-ph="${esc(ph)}"` : ''}`
    : '';
/** Text that sits next to other content (button labels, names): wrapped only in the editor. */
const et = (c: Ctx, sid: string, path: string, text: string, ph = '') =>
  c.editor ? `<span${ea(c, sid, path, false, ph)}>${esc(text)}</span>` : esc(text);
/** Editor-only controls for one list item: move and delete (handled by the editor page). */
const itemTools = (c: Ctx, sid: string, n: number, count: number) =>
  c.editor
    ? `<span class="ed-item">${n > 0 ? `<button type="button" data-act="up" data-at="${esc(sid)}:${n}" title="${c.L.editor.moveUp}">↑</button>` : ''}${n < count - 1 ? `<button type="button" data-act="down" data-at="${esc(sid)}:${n}" title="${c.L.editor.moveDown}">↓</button>` : ''}<button type="button" data-act="del" data-at="${esc(sid)}:${n}" title="${c.L.editor.remove}">✕</button></span>`
    : '';
const itemAttr = (c: Ctx) => (c.editor ? ' data-i' : '');
/** Editor-only "add an item" button at the end of a list. */
const addItem = (c: Ctx, sid: string, count: number, label: string) =>
  c.editor && count < SITE_LIMITS.items
    ? `<button type="button" class="ed-add" data-act="add" data-at="${esc(sid)}">+ ${esc(label)}</button>`
    : '';
const ei = (c: Ctx, sid: string, path: string) =>
  c.editor ? ` data-img="${esc(sid)}:${path}"` : '';

const heading = (
  eyebrow: string | undefined,
  title: string,
  sub?: string,
  titleAttr = '',
  subAttr = '',
  eyebrowAttr = '',
) =>
  `<div class="head">${eyebrow ? `<span class="eyebrow"><span${eyebrowAttr}>${esc(eyebrow)}</span></span>` : ''}<h2${titleAttr}>${esc(title)}</h2>${sub !== undefined ? `<p class="lead"${subAttr}>${esc(sub)}</p>` : ''}</div>`;

/** Hours line with times kept left-to-right. */
const hoursHtml = (line: string) => {
  const i = line.search(/\d/);
  return i < 0 ? esc(line) : `${esc(line.slice(0, i))}<bdi dir="ltr">${esc(line.slice(i))}</bdi>`;
};

/** Classes for a section's chosen look (D-082); `alt` = the automatic soft alternation. */
function styleClasses(s: Section, alt: boolean): string {
  const st = s.style ?? {};
  const bg = st.bg ?? 'auto';
  return [
    bg === 'soft' || (bg === 'auto' && alt) ? 'soft' : '',
    bg === 'brand' ? 'sec-brand' : '',
    bg === 'dark' ? 'sec-dark' : '',
    st.align === 'center' ? 'al-center' : '',
    st.spacing === 'compact' ? 'sp-compact' : st.spacing === 'airy' ? 'sp-airy' : '',
    st.titleColor === 'brand' ? 'tc-brand' : st.titleColor === 'accent' ? 'tc-accent' : '',
    st.titleSize === 'large' ? 'ts-large' : '',
    st.button === 'outline' ? 'btn-outline' : '',
  ]
    .filter(Boolean)
    .join(' ');
}
const withClasses = (base: string, extra: string) => [base, extra].filter(Boolean).join(' ');

function hero(s: Extract<Section, { type: 'hero' }>, id: string, c: Ctx): string {
  const k = styleClasses(s, false);
  const { b } = c;
  const call = b.phone ? telHref(b.phone) : '';
  const toContact = c.contactHref;
  const primaryHref = s.buttonAction === 'call' && call ? call : toContact;
  // The second button offers the other way to reach the business.
  const secondary =
    primaryHref === call && toContact
      ? `<a class="btn ghost" href="${toContact}">${icon('chat')}${et(c, s.id, 'secondaryLabel', s.secondaryLabel || c.L.leaveDetails)}</a>`
      : primaryHref !== call && call
        ? `<a class="btn ghost" href="${call}"${eb(c, 'phone')}>${icon('phone')}<bdi dir="ltr">${esc(formatIsraeliPhone(b.phone!))}</bdi></a>`
        : '';
  const chips = [
    b.serviceAreas.length
      ? `${icon('pin')}<span${eb(c, 'areas')}>${esc(b.serviceAreas.slice(0, 3).join(' · '))}</span>`
      : '',
    c.testimonialCount >= 2 ? `${icon('chat')}${esc(fill(c.L.recommend, c.testimonialCount))}` : '',
    hoursSummary(b.openingHours, c.lang).length
      ? `${icon('clock')}<span${eb(c, 'hours')}>${hoursHtml(hoursSummary(b.openingHours, c.lang)[0]!)}</span>`
      : '',
  ].filter(Boolean);
  // Short form for the badge: "בעלי מקצוע (חשמל, ...)" → "בעלי מקצוע".
  const industry =
    b.industry === 'other' ? undefined : c.L.industries[b.industry]?.replace(/\s*\(.*\)\s*$/, '');
  const bg = s.imageAssetId ? c.media[s.imageAssetId] : undefined;

  const text = `<div class="hero-text">${industry ? `<span class="eyebrow">${esc(industry)}</span>` : ''}
<h1${ea(c, s.id, 'title')}>${esc(s.title)}</h1>${s.subtitle || c.editor ? `<p class="lead"${ea(c, s.id, 'subtitle', true, c.L.editor.opening)}>${esc(s.subtitle)}</p>` : ''}
<div class="actions">${s.buttonLabel && primaryHref ? `<a class="btn" href="${primaryHref}">${et(c, s.id, 'buttonLabel', s.buttonLabel)}${icon('arrow', 'ic flip')}</a>` : ''}${secondary}</div>
${chips.length ? `<ul class="chips">${chips.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}</div>`;

  if (bg) {
    return `<header class="${withClasses('hero has-img', k)}" id="${id}">${img(bg, '', 'hero-bg', false)}<div class="wrap">${text}</div></header>`;
  }
  // No photo: a "business card" with the real contact details balances the layout.
  const rows = [
    b.phone
      ? `<li${eb(c, 'phone')}>${icon('phone')}<div><span class="k">${c.L.phone}</span><a href="${call}"><bdi dir="ltr">${esc(formatIsraeliPhone(b.phone))}</bdi></a></div></li>`
      : '',
    b.address
      ? `<li${eb(c, 'address')}>${icon('pin')}<div><span class="k">${c.L.address}</span><span>${esc(b.address)}</span></div></li>`
      : '',
    hoursSummary(b.openingHours, c.lang).length
      ? `<li${eb(c, 'hours')}>${icon('clock')}<div><span class="k">${c.L.hours}</span>${hoursSummary(
          b.openingHours,
          c.lang,
        )
          .map((l) => `<span>${hoursHtml(l)}</span>`)
          .join('')}</div></li>`
      : '',
  ].filter(Boolean);
  return `<header class="${withClasses('hero', k)}" id="${id}"><div class="wrap hero-grid">${text}${
    rows.length
      ? `<aside class="biz-card" aria-label="${c.L.businessDetails}"><p class="biz-name">${esc(b.name)}</p><ul>${rows.join('')}</ul>${
          toContact
            ? `<a class="card-link" href="${toContact}">${et(c, '$theme', 'labels.cardLink', c.labels.cardLink || c.L.cardLink)} ${icon('arrow', 'ic flip')}</a>`
            : ''
        }</aside>`
      : ''
  }</div></header>`;
}

function section(s: Section, c: Ctx, alt: boolean): string {
  const { b, media } = c;
  const id = `s-${esc(s.id)}`;
  const k = styleClasses(s, alt);
  const cls = k ? ` class="${k}"` : '';
  switch (s.type) {
    case 'hero':
      return hero(s, id, c);
    case 'about': {
      const pic = s.imageAssetId ? media[s.imageAssetId] : undefined;
      return pic
        ? `<section id="${id}"${cls}><div class="wrap about-grid"><div class="about-text">${heading(navLabel(s, c), s.title, undefined, ea(c, s.id, 'title'), '', ea(c, s.id, 'navLabel'))}${c.editor ? `<div${ea(c, s.id, 'body', true)}>${paragraphs(s.body)}</div>` : paragraphs(s.body)}</div><div class="about-media">${img(pic, s.imageAlt, 'about-img', true, ei(c, s.id, 'imageAssetId'))}</div></div></section>`
        : `<section id="${id}"${cls}><div class="wrap narrow about-solo">${heading(navLabel(s, c), s.title, undefined, ea(c, s.id, 'title'), '', ea(c, s.id, 'navLabel'))}<div class="about-body"${ea(c, s.id, 'body', true)}>${paragraphs(s.body)}</div></div></section>`;
    }
    case 'gallery': {
      const pics = s.items.map((i, n) => ({ ...i, n })).filter((i) => media[i.assetId]);
      if (pics.length === 0) {
        // In the editor an empty gallery still shows, so it can be clicked and filled.
        return c.editor
          ? `<section id="${id}"${cls}><div class="wrap">${heading(navLabel(s, c), s.title, undefined, ea(c, s.id, 'title'), '', ea(c, s.id, 'navLabel'))}<p class="ed-empty">${esc(c.L.editor.emptyGallery)}</p></div></section>`
          : '';
      }
      return `<section id="${id}"${cls}><div class="wrap">${heading(navLabel(s, c), s.title, undefined, ea(c, s.id, 'title'), '', ea(c, s.id, 'navLabel'))}<div class="gallery${pics.length >= 3 ? ' feature' : ''}">${pics
        .map(
          (i) =>
            `<figure>${img(media[i.assetId]!, i.caption, 'gallery-img', true, ei(c, s.id, `items.${i.n}.assetId`))}${i.caption ? `<figcaption${ea(c, s.id, `items.${i.n}.caption`)}>${esc(i.caption)}</figcaption>` : ''}</figure>`,
        )
        .join('')}</div></div></section>`;
    }
    case 'services':
      return `<section id="${id}"${cls}><div class="wrap">${heading(navLabel(s, c), s.title, undefined, ea(c, s.id, 'title'), '', ea(c, s.id, 'navLabel'))}<div class="grid services">${s.items
        .map(
          (i, n) =>
            `<article class="card service"${itemAttr(c)}>${itemTools(c, s.id, n, s.items.length)}<span class="tile">${icon('check')}</span><h3${ea(c, s.id, `items.${n}.name`, false, c.L.editor.serviceName)}>${esc(i.name)}</h3>${i.description || c.editor ? `<p${ea(c, s.id, `items.${n}.description`, true, c.L.editor.shortDescription)}>${esc(i.description)}</p>` : ''}</article>`,
        )
        .join('')}${addItem(c, s.id, s.items.length, c.L.editor.addService)}</div></div></section>`;
    case 'pricing':
      return `<section id="${id}"${cls}><div class="wrap narrow">${heading(navLabel(s, c), s.title, undefined, ea(c, s.id, 'title'), '', ea(c, s.id, 'navLabel'))}<div class="card price-card"><ul class="prices">${s.items
        .map(
          (i, n) =>
            `<li${itemAttr(c)}><span${ea(c, s.id, `items.${n}.name`, false, c.L.editor.priceItem)}>${esc(i.name)}</span><span class="dots"></span><bdi${ea(c, s.id, `items.${n}.price`, false, c.L.editor.price)}>${esc(i.price)}</bdi>${itemTools(c, s.id, n, s.items.length)}</li>`,
        )
        .join(
          '',
        )}</ul>${addItem(c, s.id, s.items.length, c.L.editor.addRow)}${s.note || c.editor ? `<p class="note"${ea(c, s.id, 'note', true, c.L.editor.priceNote)}>${esc(s.note)}</p>` : ''}</div></div></section>`;
    case 'testimonials': {
      const items = s.items.map((i, n) => ({ ...i, n })).filter((i) => i.quote || c.editor);
      if (items.length === 0 && !c.editor) return '';
      return `<section id="${id}"${cls}><div class="wrap">${heading(navLabel(s, c), s.title, undefined, ea(c, s.id, 'title'), '', ea(c, s.id, 'navLabel'))}<div class="grid">${items
        .map(
          (i) =>
            `<figure class="card quote"${itemAttr(c)}>${itemTools(c, s.id, i.n, s.items.length)}<span class="qmark" aria-hidden="true">”</span><blockquote${ea(c, s.id, `items.${i.n}.quote`, true, c.L.editor.quote)}>${esc(i.quote)}</blockquote>${
              i.author || c.editor
                ? `<figcaption><span class="avatar" aria-hidden="true">${esc(i.author.trim().charAt(0))}</span>${et(c, s.id, `items.${i.n}.author`, i.author, c.L.editor.author)}</figcaption>`
                : ''
            }</figure>`,
        )
        .join(
          '',
        )}${addItem(c, s.id, s.items.length, c.L.editor.addTestimonial)}</div></div></section>`;
    }
    case 'faq':
      return `<section id="${id}"${cls}><div class="wrap narrow">${heading(navLabel(s, c), s.title, undefined, ea(c, s.id, 'title'), '', ea(c, s.id, 'navLabel'))}<div class="faq">${s.items
        .map((i, n) => ({ ...i, n }))
        .filter((i) => i.question || c.editor)
        .map(
          (i, k) =>
            `<details${k === 0 || c.editor ? ' open' : ''}${itemAttr(c)}>${itemTools(c, s.id, i.n, s.items.length)}<summary>${et(c, s.id, `items.${i.n}.question`, i.question, c.L.editor.question)}</summary><p${ea(c, s.id, `items.${i.n}.answer`, true, c.L.editor.answer)}>${esc(i.answer)}</p></details>`,
        )
        .join(
          '',
        )}${addItem(c, s.id, s.items.length, c.L.editor.addQuestion)}</div></div></section>`;
    case 'contact': {
      const rows: string[] = [];
      if (s.showPhone && b.phone) {
        rows.push(
          `<li${eb(c, 'phone')}>${icon('phone')}<div><span class="k">${c.L.phone}</span><a href="${telHref(b.phone)}"><bdi dir="ltr">${esc(formatIsraeliPhone(b.phone))}</bdi></a></div></li>`,
        );
      }
      if (s.showAddress && b.address) {
        rows.push(
          `<li${eb(c, 'address')}>${icon('pin')}<div><span class="k">${c.L.address}</span><a href="${mapsHref(b.address)}" target="_blank" rel="noopener">${esc(b.address)}</a></div></li>`,
        );
      }
      if (b.serviceAreas.length) {
        rows.push(
          `<li${eb(c, 'areas')}>${icon('check')}<div><span class="k">${c.L.areas}</span><span>${esc(b.serviceAreas.join(', '))}</span></div></li>`,
        );
      }
      const hours =
        s.showHours && b.openingHours
          ? `<table class="hours"${eb(c, 'hours')}><caption>${c.L.hours}</caption>${WEEKDAYS.map(
              (d) => {
                const h = b.openingHours?.[d];
                return `<tr><th scope="row">${c.L.weekdays[d]}</th><td>${h?.open ? `<bdi dir="ltr">${esc(h.from)}–${esc(h.to)}</bdi>` : `<span class="closed">${c.L.closed}</span>`}</td></tr>`;
              },
            ).join('')}</table>`
          : '';
      const form = s.form.enabled
        ? `<div class="form-wrap">${leadForm(s, b, c.pageSlug, c.L)}</div>`
        : '';
      // One panel: details on a brand-coloured side, the form beside them; either may be alone.
      const info =
        rows.length || hours
          ? `<div class="contact-info">${rows.length ? `<ul class="info">${rows.join('')}</ul>` : ''}${hours}</div>`
          : '';
      return `<section id="${id}" class="${withClasses('contact', k)}"><div class="wrap">${heading(navLabel(s, c), s.title, c.editor ? s.subtitle : s.subtitle || undefined, ea(c, s.id, 'title'), ea(c, s.id, 'subtitle', true, c.L.editor.optionalOpening), ea(c, s.id, 'navLabel'))}
${info || form ? `<div class="contact-grid${info && form ? '' : ' solo'}">${info}${form}</div>` : ''}</div></section>`;
    }
    case 'cta': {
      const href = b.phone ? telHref(b.phone) : c.contactHref;
      return `<section id="${id}" class="${withClasses('cta-wrap', k.replace(/\bsoft\b/, ''))}"><div class="wrap"><div class="cta"><div><h2${ea(c, s.id, 'title')}>${esc(s.title)}</h2>${s.subtitle || c.editor ? `<p${ea(c, s.id, 'subtitle', true, c.L.editor.optionalText)}>${esc(s.subtitle)}</p>` : ''}</div>${s.buttonLabel && href ? `<a class="btn light" href="${href}">${b.phone ? icon('phone') : ''}${et(c, s.id, 'buttonLabel', s.buttonLabel)}</a>` : ''}</div></div></section>`;
    }
  }
}

function documentHead(theme: SiteTheme, title: string, description: string, noindex = false) {
  const lang = theme.language ?? 'he';
  const palette = resolvePalette(theme);
  const font = FONTS[theme.font];
  const fontParam = encodeURIComponent(font.family).replace(/%20/g, '+');
  return `<!doctype html>
<html lang="${lang}" dir="${siteText(lang).dir}">
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

function css(palette: ReturnType<typeof resolvePalette>, family: string) {
  return `
:root{--p:${palette.primary};--a:${palette.accent};--soft:${palette.soft};--pd:color-mix(in srgb,var(--p) 78%,#000);--pt:color-mix(in srgb,var(--p) 9%,#fff);--tint:color-mix(in srgb,var(--p) 3%,#f6f7f9);--ink:#121821;--muted:#5a6573;--line:#e4e7eb;--r:16px;--rl:24px;--sh:0 1px 2px rgba(16,24,40,.05),0 2px 6px -2px rgba(16,24,40,.06);--shl:0 1px 2px rgba(16,24,40,.04),0 28px 56px -24px rgba(16,24,40,.24)}
*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;font-family:'${family}',system-ui,Arial,sans-serif;color:var(--ink);line-height:1.7;background:#fff;font-size:17px;-webkit-font-smoothing:antialiased}
img{max-width:100%}
.wrap{max-width:1200px;margin:0 auto;padding:0 24px}.narrow{max-width:820px}
section{padding:104px 0;scroll-margin-top:76px}section.soft{background:var(--tint)}
h1,h2,h3{line-height:1.15;margin:0 0 .5em;letter-spacing:-.02em}
h1{font-size:clamp(2.4rem,5.8vw,4.4rem);font-weight:800}h2{font-size:clamp(1.9rem,3.8vw,2.75rem);font-weight:800}h3{font-size:1.18rem;font-weight:700;letter-spacing:-.01em}
p{margin:0 0 1em}.lead{font-size:1.15rem;color:var(--muted);max-width:620px}
a{color:var(--p)}
.ic{width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
:focus-visible{outline:3px solid var(--a);outline-offset:2px}
.head{margin-bottom:48px;max-width:700px}.head .lead{margin-top:-.1em}
.narrow .head{text-align:center;margin-inline:auto}.narrow .head .lead{margin-inline:auto}
.eyebrow{display:inline-flex;align-items:center;gap:10px;font-size:.84rem;font-weight:700;letter-spacing:.04em;color:var(--p);margin-bottom:14px}
.eyebrow::before{content:"";width:28px;height:2px;border-radius:2px;background:var(--a)}
/* Header */
.nav{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.92);backdrop-filter:saturate(1.6) blur(12px);-webkit-backdrop-filter:saturate(1.6) blur(12px);border-bottom:1px solid var(--line)}
.nav .wrap{display:flex;align-items:center;gap:24px;height:76px}
.brand{display:inline-flex;align-items:center;gap:12px;font-weight:800;font-size:1.2rem;letter-spacing:-.01em;color:var(--ink);text-decoration:none;margin-inline-end:auto}
.logo{height:44px;width:auto;max-width:160px;object-fit:contain}
.mark{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--p),var(--pd));color:#fff;font-size:1.1rem}
.menu{display:flex;gap:2px;list-style:none;margin:0;padding:0}
.menu a{display:block;padding:8px 14px;border-radius:10px;color:#3b4553;text-decoration:none;font-size:.96rem;font-weight:500;transition:color .15s,background .15s}
.mmenu{display:none;position:relative}.mmenu summary{list-style:none;cursor:pointer;display:flex;width:44px;height:44px;align-items:center;justify-content:center;border-radius:12px;border:1px solid var(--line)}
.mmenu summary::-webkit-details-marker{display:none}.mmenu summary::after{display:none}
.mmenu ul{position:absolute;inset-inline-end:0;top:calc(100% + 8px);list-style:none;margin:0;padding:8px;min-width:210px;background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:var(--shl);z-index:30}
.mmenu a{display:block;padding:10px 12px;border-radius:10px;color:var(--ink);text-decoration:none;font-weight:500}.mmenu a[aria-current=page]{background:var(--pt);color:var(--p)}
.menu a[aria-current=page]{color:var(--p);background:var(--pt)}
.menu a:hover{color:var(--p);background:var(--pt)}
.call{display:inline-flex;align-items:center;gap:8px;background:var(--p);color:#fff;text-decoration:none;border-radius:12px;padding:10px 18px;font-weight:700;font-size:.95rem;white-space:nowrap;transition:background .15s}
.call:hover{background:var(--pd)}
/* Buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:var(--p);color:#fff;text-decoration:none;font-weight:700;padding:15px 28px;border-radius:12px;border:2px solid var(--p);box-shadow:0 12px 24px -14px var(--p);transition:transform .15s,background .15s,border-color .15s}
.btn:hover{background:var(--pd);border-color:var(--pd);transform:translateY(-1px)}
.btn .ic{width:18px;height:18px}[dir=ltr] .flip{transform:scaleX(-1)}
.btn.ghost{background:#fff;color:var(--ink);border-color:var(--line);box-shadow:none}.btn.ghost:hover{border-color:var(--p);color:var(--p);background:#fff}
.btn.light{background:#fff;color:var(--p);border-color:#fff;box-shadow:none}.btn.light:hover{background:var(--pt);border-color:var(--pt)}
/* Hero */
.hero{position:relative;overflow:hidden;padding:112px 0 120px;background:radial-gradient(900px 480px at 100% 0%,color-mix(in srgb,var(--a) 12%,transparent),transparent 65%),radial-gradient(800px 480px at 0% 100%,color-mix(in srgb,var(--p) 9%,transparent),transparent 65%),linear-gradient(180deg,var(--tint),#fff)}
.hero-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,.85fr);gap:64px;align-items:center}
.hero .lead{font-size:1.25rem;margin-bottom:2em}
.actions{display:flex;flex-wrap:wrap;gap:12px}
.chips{display:flex;flex-wrap:wrap;gap:10px 26px;list-style:none;margin:36px 0 0;padding:0;color:var(--muted);font-size:.95rem}
.chips li{display:inline-flex;align-items:center;gap:8px}.chips .ic{color:var(--p);width:18px;height:18px}
.biz-card{background:#fff;border:1px solid var(--line);border-radius:var(--rl);padding:32px;box-shadow:var(--shl);position:relative}
.biz-card::before{content:"";position:absolute;inset-inline:32px;top:-1px;height:4px;border-radius:0 0 4px 4px;background:linear-gradient(90deg,var(--p),var(--a))}
.biz-name{font-weight:800;font-size:1.3rem;margin:0 0 20px;padding-bottom:18px;border-bottom:1px solid var(--line)}
.biz-card ul,.info{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:20px}
.biz-card li,.info li{display:flex;gap:14px;align-items:flex-start}
.biz-card li>.ic,.info li>.ic{width:44px;height:44px;padding:11px;border-radius:12px;background:var(--pt);color:var(--p)}
.biz-card li div,.info li div{display:flex;flex-direction:column}
.k{font-size:.82rem;color:var(--muted);font-weight:500}
.biz-card a,.info a{color:var(--ink);font-weight:700;text-decoration:none;font-size:1.08rem}.biz-card a:hover,.info a:hover{color:var(--p)}
.card-link{display:flex!important;align-items:center;justify-content:space-between;margin-top:24px;padding:14px 18px;border-radius:12px;background:var(--pt);color:var(--p)!important;font-size:1rem!important}
.hero.has-img{min-height:min(720px,86vh);display:flex;align-items:center;background:#0d1015;color:#fff}
.hero-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero.has-img::before{content:"";position:absolute;inset:0;background:linear-gradient(270deg,rgba(8,10,14,.86),rgba(8,10,14,.55) 55%,rgba(8,10,14,.25)),linear-gradient(0deg,rgba(8,10,14,.5),transparent 40%);z-index:1}
[dir=ltr] .hero.has-img::before{background:linear-gradient(90deg,rgba(8,10,14,.86),rgba(8,10,14,.55) 55%,rgba(8,10,14,.25)),linear-gradient(0deg,rgba(8,10,14,.5),transparent 40%)}
.hero.has-img .wrap{position:relative;z-index:2;width:100%}.hero.has-img .hero-text{max-width:680px}
.hero.has-img h1{text-shadow:0 2px 24px rgba(0,0,0,.25)}
.hero.has-img .lead,.hero.has-img .chips{color:rgba(255,255,255,.9)}.hero.has-img .chips .ic{color:#fff}
.hero.has-img .eyebrow{color:#fff}.hero.has-img .eyebrow::before{background:var(--a)}
.hero.has-img .btn.ghost{background:rgba(255,255,255,.08);color:#fff;border-color:rgba(255,255,255,.45);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.hero.has-img .btn.ghost:hover{background:rgba(255,255,255,.16);border-color:#fff}
/* Cards & grids */
.grid{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.card{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:32px;margin:0;box-shadow:var(--sh)}
.card p{color:var(--muted);margin:0}
.service{position:relative;overflow:hidden;transition:transform .2s,box-shadow .2s,border-color .2s}
.service::after{content:"";position:absolute;inset-inline:0;top:0;height:3px;background:linear-gradient(90deg,var(--p),var(--a));transform:scaleX(0);transition:transform .3s}
.service:hover{transform:translateY(-4px);box-shadow:var(--shl);border-color:color-mix(in srgb,var(--p) 25%,var(--line))}.service:hover::after{transform:scaleX(1)}
.tile{display:inline-flex;width:52px;height:52px;border-radius:14px;align-items:center;justify-content:center;background:var(--pt);color:var(--p);margin-bottom:22px}
.tile .ic{width:24px;height:24px;stroke-width:2.3}
.price-card{padding:8px 36px;box-shadow:var(--shl)}
.prices{list-style:none;margin:0;padding:0}.prices li{display:flex;align-items:baseline;gap:14px;padding:20px 0;border-bottom:1px solid var(--line);font-weight:600;font-size:1.05rem}.prices li:last-child{border-bottom:0}
.prices .dots{flex:1;border-bottom:1px dashed #cfd5dc}.prices bdi{font-weight:800;color:var(--p);font-size:1.15rem}
.note{color:var(--muted);font-size:.95rem;margin:0;padding:16px 0 20px;text-align:center;border-top:1px solid var(--line)}
.quote{display:flex;flex-direction:column;padding:36px}.qmark{font-family:Georgia,'Times New Roman',serif;font-size:4.2rem;line-height:.8;height:.5em;color:var(--a);margin-bottom:22px}
.quote blockquote{margin:0 0 28px;font-size:1.12rem;line-height:1.75;flex:1;color:var(--ink)}
.quote figcaption{display:flex;align-items:center;gap:12px;font-weight:700;padding-top:20px;border-top:1px solid var(--line)}
.avatar{display:inline-flex;width:42px;height:42px;border-radius:50%;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--p),var(--pd));color:#fff;font-weight:800}
.faq{display:flex;flex-direction:column;gap:12px}
details{background:#fff;border:1px solid var(--line);border-radius:14px;padding:0 24px;transition:box-shadow .2s,border-color .2s}details[open]{box-shadow:var(--sh);border-color:color-mix(in srgb,var(--p) 30%,var(--line))}
summary{cursor:pointer;font-weight:700;font-size:1.05rem;list-style:none;padding:22px 0;display:flex;justify-content:space-between;gap:16px;align-items:center}
summary::-webkit-details-marker{display:none}
summary::after{content:"+";flex:none;width:32px;height:32px;border-radius:10px;background:var(--pt);color:var(--p);display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:500;line-height:1}
details[open] summary::after{content:"−";background:var(--p);color:#fff}details p{margin:0 0 22px;color:var(--muted)}
.about-grid{display:grid;gap:72px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:center}
.about-text p,.about-body p{color:#3a4450;font-size:1.1rem}
.about-media{position:relative}.about-media::after{content:"";position:absolute;inset:24px -24px -24px 24px;border-radius:var(--rl);background:linear-gradient(135deg,var(--pt),color-mix(in srgb,var(--a) 14%,#fff));z-index:-1}
.about-img{width:100%;height:auto;aspect-ratio:4/3;border-radius:var(--rl);object-fit:cover;display:block;box-shadow:var(--shl)}
.about-solo .head{text-align:center;margin-inline:auto}.about-body{border-inline-start:3px solid var(--a);padding-inline-start:28px}
.gallery{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));grid-auto-rows:240px}
.gallery.feature figure:first-child{grid-column:span 2;grid-row:span 2}
.gallery figure{margin:0;overflow:hidden;border-radius:var(--r);background:var(--tint);position:relative}
.gallery-img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .5s}.gallery figure:hover .gallery-img{transform:scale(1.04)}
.gallery figcaption{position:absolute;inset-inline:0;bottom:0;font-size:.92rem;color:#fff;padding:28px 16px 12px;background:linear-gradient(0deg,rgba(0,0,0,.6),transparent)}
/* CTA */
.cta-wrap{padding:32px 0 104px}
.cta{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:28px;padding:56px;border-radius:28px;color:#fff;background:radial-gradient(520px 280px at 0% 0%,color-mix(in srgb,var(--a) 40%,transparent),transparent 70%),radial-gradient(420px 260px at 100% 100%,rgba(255,255,255,.12),transparent 70%),linear-gradient(135deg,var(--p),var(--pd));box-shadow:0 30px 60px -30px var(--p)}
.cta h2{color:#fff;margin:0 0 .3em}.cta p{margin:0;opacity:.9;font-size:1.12rem}
/* Contact */
.contact-grid{display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);align-items:stretch;background:#fff;border:1px solid var(--line);border-radius:var(--rl);overflow:hidden;box-shadow:var(--shl)}
.contact-grid.solo{grid-template-columns:minmax(0,1fr)}
.contact-info{display:flex;flex-direction:column;gap:32px;padding:44px;color:#fff;background:radial-gradient(400px 260px at 0% 100%,color-mix(in srgb,var(--a) 35%,transparent),transparent 70%),linear-gradient(160deg,var(--p),var(--pd))}
.contact-info .info li>.ic{background:rgba(255,255,255,.14);color:#fff}
.contact-info .k{color:rgba(255,255,255,.75)}.contact-info .info a,.contact-info .info span{color:#fff}.contact-info .info a:hover{color:#fff;text-decoration:underline}
.contact-grid.solo .contact-info .info{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.hours{border-collapse:collapse;width:100%;font-size:.97rem}
.hours caption{text-align:start;font-weight:800;padding-bottom:10px;font-size:1.05rem}
.hours th,.hours td{padding:9px 0;text-align:start;font-weight:500}.hours td{text-align:end}.hours tr+tr{border-top:1px solid var(--line)}.closed{color:var(--muted)}
.contact-info .hours tr+tr{border-top-color:rgba(255,255,255,.18)}.contact-info .closed{color:rgba(255,255,255,.65)}
.form-wrap{padding:44px}
.lead-form{display:flex;flex-direction:column;gap:18px}
.lead-form label{display:flex;flex-direction:column;gap:7px;font-size:.95rem;font-weight:700}
.lead-form input,.lead-form textarea,.lead-form select{font:inherit;font-weight:400;padding:13px 16px;border:1px solid #d8dde3;border-radius:12px;background:#f8f9fb;color:var(--ink);transition:border-color .15s,background .15s,box-shadow .15s}
.lead-form input:focus,.lead-form textarea:focus,.lead-form select:focus{outline:none;border-color:var(--p);background:#fff;box-shadow:0 0 0 4px color-mix(in srgb,var(--p) 15%,transparent)}
.slot{border:1px dashed #d0d6dd;border-radius:14px;padding:14px 16px 6px;margin:0;display:flex;flex-direction:column;gap:12px}
.slot legend{font-weight:700;font-size:.95rem;padding:0 6px}.slot-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.slot-note{margin:0 0 6px;font-size:.85rem;color:var(--muted)}
.lead-form .consent{flex-direction:row;align-items:flex-start;gap:10px;font-weight:400;color:var(--muted);font-size:.9rem}
.lead-form .consent input{margin-top:4px;width:18px;height:18px;padding:0;accent-color:var(--p)}
.lead-form .btn{cursor:pointer;font:inherit;font-weight:700;width:100%;margin-top:4px}
.hp{position:absolute;inset-inline-start:-10000px;width:1px;height:1px;overflow:hidden}
/* Footer */
footer{background:#0e1218;color:rgba(255,255,255,.68);padding:80px 0 0;font-size:.95rem}
.foot{display:grid;gap:40px;grid-template-columns:minmax(0,1.5fr) repeat(2,minmax(0,1fr));padding-bottom:56px}
footer h3{color:#fff;font-size:.95rem;letter-spacing:.02em;margin:0 0 16px}footer .brand{color:#fff;margin-bottom:16px}footer p{margin:0;max-width:380px}
footer .foot-pages{flex-direction:row;flex-wrap:wrap;gap:6px 18px;margin-top:18px}
footer ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}footer a{color:#fff;text-decoration:none}footer a:hover{color:color-mix(in srgb,var(--a) 60%,#fff)}
.bottom{border-top:1px solid rgba(255,255,255,.08);padding:20px 0;font-size:.85rem;color:rgba(255,255,255,.45)}
/* Section looks (D-082) */
section.sp-compact,.hero.sp-compact{padding-top:56px;padding-bottom:56px}section.sp-airy,.hero.sp-airy{padding-top:144px;padding-bottom:144px}
.al-center .head,.al-center .hero-text{text-align:center;margin-inline:auto}.al-center .hero-text .lead{margin-inline:auto}.al-center .actions,.al-center .chips{justify-content:center}
.al-center .about-body{border:0;padding:0;text-align:center}.al-center .hero-grid{grid-template-columns:1fr}.al-center .biz-card{display:none}
.tc-brand h1,.tc-brand .head h2,.tc-brand .cta h2{color:var(--p)}.tc-accent h1,.tc-accent .head h2,.tc-accent .cta h2{color:var(--a)}
.ts-large h1{font-size:clamp(2.8rem,7vw,5.2rem)}.ts-large .head h2,.ts-large .cta h2{font-size:clamp(2.2rem,4.8vw,3.4rem)}
.btn-outline .btn:not(.ghost):not(.light){background:transparent;color:var(--p);border-color:var(--p);box-shadow:none}
.btn-outline .btn.light{background:transparent;color:#fff;border-color:#fff}
section.sec-brand,.hero.sec-brand{background:linear-gradient(135deg,var(--p),var(--pd));color:#fff}
section.sec-dark,.hero.sec-dark{background:#0e1218;color:#fff}
:is(.sec-brand,.sec-dark) :is(h1,.head h2,.head .lead,.about-body p,.about-text p,.note,.slot-note){color:#fff}
:is(.sec-brand,.sec-dark) .head .lead,:is(.sec-brand,.sec-dark) .hero-text .lead,:is(.sec-brand,.sec-dark) .chips{color:rgba(255,255,255,.85)}
:is(.sec-brand,.sec-dark) .eyebrow{color:#fff}
:is(.sec-brand,.sec-dark) .chips .ic{color:#fff}
.hero.sec-brand .btn:not(.ghost),.hero.sec-dark .btn:not(.ghost){background:#fff;color:var(--p);border-color:#fff}
.hero.sec-brand .btn.ghost,.hero.sec-dark .btn.ghost{background:transparent;color:#fff;border-color:rgba(255,255,255,.55)}
:is(.sec-brand,.sec-dark) .card,:is(.sec-brand,.sec-dark) details,:is(.sec-brand,.sec-dark) .lead-form,:is(.sec-brand,.sec-dark) .price-card .note{color:var(--ink)}
:is(.sec-brand,.sec-dark) .price-card .note,:is(.sec-brand,.sec-dark) .lead-form .slot-note{color:var(--muted)}
:is(.sec-brand,.sec-dark) .info a,:is(.sec-brand,.sec-dark) .info span,:is(.sec-brand,.sec-dark) .hours caption{color:#fff}
:is(.sec-brand,.sec-dark) .tc-brand h2{color:#fff}
.sec-brand .contact-info{background:#0e1218}
/* Mobile call bar */
.mbar{display:none}
.empty{padding:120px 20px;text-align:center;color:var(--muted)}
.msg{max-width:560px;margin:0 auto;padding:96px 20px;text-align:center}.msg ul{text-align:start;color:var(--muted)}
@media (max-width:960px){.menu{display:none}.mmenu{display:block}.hero-grid,.contact-grid{grid-template-columns:minmax(0,1fr)}.hero-grid{gap:44px}.foot{grid-template-columns:1fr 1fr}.foot>div:first-child{grid-column:1/-1}.about-grid{gap:56px}}
@media (max-width:640px){
body{font-size:16px}section{padding:64px 0}.hero{padding:60px 0 68px}.hero.has-img{min-height:min(620px,82vh)}.head{margin-bottom:32px}.wrap{padding:0 16px}
.nav .wrap{height:64px}.call .num-text{display:none}.call{padding:10px 14px}
.actions .btn{flex:1 1 100%}.cta{padding:36px 24px;border-radius:22px}.cta .btn{width:100%}.cta-wrap{padding:16px 0 64px}.price-card{padding:4px 20px}.card,.quote{padding:24px}
.contact-info,.form-wrap{padding:26px 22px}
.gallery{grid-template-columns:1fr 1fr;grid-auto-rows:160px;gap:10px}.gallery.feature figure:first-child{grid-row:span 1}
.about-media::after{inset:14px -10px -14px 10px}
.foot{grid-template-columns:1fr}.biz-card{display:none}
.mbar{display:flex;gap:10px;position:fixed;inset-inline:0;bottom:0;z-index:30;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:rgba(255,255,255,.96);border-top:1px solid var(--line);box-shadow:0 -8px 24px -16px rgba(0,0,0,.3)}
.mbar a{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px;border-radius:12px;font-weight:700;text-decoration:none;background:var(--p);color:#fff}
.mbar a.alt{background:var(--pt);color:var(--p)}
body.has-mbar{padding-bottom:78px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
`;
}

/** Editor-only: an empty page offers its first section right there (D-089). */
const emptyPagePicker = (L: SiteText) =>
  `<section class="ed-start"><div class="wrap narrow"><h2>${L.editor.startTitle}</h2><p>${L.editor.startText}</p><div class="ed-start-grid">${SECTION_TYPES.map(
    (t) =>
      `<button type="button" data-act="new" data-at="${t}">+ ${esc(L.sectionTypes[t])}</button>`,
  ).join('')}</div></div></section>`;

/** Hover/edit affordances for the editor preview only (published pages never include them). */
const editorStyle = (L: SiteText) => `<style>
[data-edit]{cursor:text;border-radius:6px;outline:2px dashed transparent;outline-offset:4px;transition:outline-color .15s}
[data-edit]:hover{outline-color:rgba(44,131,125,.6)}
[data-edit][contenteditable]{outline:2px solid #2c837d;background:rgba(44,131,125,.08)}
[data-img]{cursor:pointer;transition:filter .15s}[data-img]:hover{filter:brightness(.85);outline:3px solid #2c837d;outline-offset:-3px}
[data-ph]:empty{min-height:1.5em;min-width:3em}[data-ph]:empty::before{content:attr(data-ph);color:#9aa3ad;font-weight:400}
[data-biz]{cursor:pointer;border-radius:8px;outline:2px dashed transparent;outline-offset:4px}[data-biz]:hover{outline-color:rgba(224,165,38,.8)}
[data-i]{position:relative}
.ed-start{padding:72px 0;text-align:center}.ed-start h2{margin-bottom:.3em}.ed-start p{color:#64748b;margin-bottom:28px}
.ed-start-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.ed-start-grid button{padding:16px 12px;border:2px dashed #b9c3c9;border-radius:16px;background:#fff;color:#2c837d;font:600 15px system-ui;cursor:pointer}
.ed-start-grid button:hover{border-color:#2c837d;background:rgba(44,131,125,.06)}
.ed-empty{border:2px dashed #b9c3c9;border-radius:18px;padding:40px 20px;text-align:center;color:#64748b;font:500 15px system-ui}
.mark-empty{position:relative}.mark-empty:hover::after{content:"${L.editor.addLogo}";position:absolute;top:calc(100% + 8px);inset-inline-start:0;white-space:nowrap;background:#18202a;color:#fff;font:600 12px/1 system-ui;padding:7px 10px;border-radius:8px;z-index:40}
.ed-item{position:absolute;top:8px;inset-inline-end:8px;z-index:3;display:flex;gap:4px;opacity:0;pointer-events:none;transition:opacity .15s}
[data-i]:hover>.ed-item,[data-i]:focus-within>.ed-item{opacity:1;pointer-events:auto}
.service:hover{transform:none}
.ed-item button{width:28px;height:28px;border-radius:8px;border:0;background:#18202a;color:#fff;font:600 13px/1 system-ui;cursor:pointer;opacity:.85}
.ed-item button:hover{opacity:1}.ed-item button[data-act=del]:hover{background:#c0392b}
.prices li .ed-item{top:50%;transform:translateY(-50%);inset-inline-end:-40px}
.ed-add{display:flex;align-items:center;justify-content:center;min-height:56px;width:100%;margin-top:12px;border:2px dashed #b9c3c9;border-radius:18px;background:transparent;color:#2c837d;font:600 15px system-ui;cursor:pointer}
.grid>.ed-add{margin-top:0;min-height:120px}.ed-add:hover{background:rgba(44,131,125,.06);border-color:#2c837d}
</style>`;

export function renderSitePage(
  draft: Omit<SiteDraft, 'templateKey'>,
  b: SiteBusinessInfo,
  media: MediaMap = {},
  /** `page`: an extra page's address; omitted = the home page (D-081). */
  opts: { editor?: boolean; page?: string } = {},
): string {
  const logo = draft.theme.logoAssetId ? media[draft.theme.logoAssetId] : undefined;
  const pages = draft.pages ?? [];
  const page = opts.page ? pages.find((p) => p.slug === opts.page) : undefined;
  const visible = (page ? page.sections : draft.sections).filter((s) => s.visible);
  const seo = page
    ? {
        title: page.seo.title || `${page.title} · ${b.name}`,
        description: page.seo.description || draft.seo.description,
      }
    : draft.seo;
  const contactId = visible.find((s) => s.type === 'contact')?.id;
  const homeContactId = draft.sections.find((s) => s.visible && s.type === 'contact')?.id;
  const contactHref = contactId
    ? `#s-${esc(contactId)}`
    : homeContactId
      ? `/#s-${esc(homeContactId)}`
      : '';
  const testimonialCount = visible
    .filter((s) => s.type === 'testimonials')
    .reduce(
      (n, s) => n + (s.type === 'testimonials' ? s.items.filter((i) => i.quote).length : 0),
      0,
    );
  const ctx: Ctx = {
    b,
    contactHref,
    pageSlug: page?.slug ?? '',
    media,
    testimonialCount,
    editor: opts.editor ?? false,
    labels: draft.theme.labels ?? {},
    lang: draft.theme.language,
    L: siteText(draft.theme.language),
  };

  // Header menu: the site's pages when it has any in the menu (D-081); otherwise the first
  // section of each type that has a short label.
  const menuPages = pages.filter((p) => p.inMenu);
  const pageLink = (href: string, label: string, current: boolean) =>
    `<li><a href="${href}"${current ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`;
  // The home page's sections stay in the menu, and pages are added after them; a section with
  // the same name as a page ("אודות") gives way to the page (D-086).
  const pageTitles = new Set(menuPages.map((p) => p.title));
  const seen = new Set<string>();
  const sectionLinks = draft.sections
    .filter((s) => s.visible)
    .filter((s) => ctx.L.nav[s.type] && !seen.has(s.type) && seen.add(s.type))
    .filter((s) => s.type !== 'gallery' || s.items.some((i) => media[i.assetId]))
    .filter((s) => !pageTitles.has(navLabel(s, ctx)))
    .map((s) =>
      page
        ? `<li><a href="/#s-${esc(s.id)}">${esc(navLabel(s, ctx))}</a></li>`
        : `<li><a href="#s-${esc(s.id)}">${et(ctx, s.id, 'navLabel', navLabel(s, ctx))}</a></li>`,
    );
  const menu = [
    ...(page ? [pageLink('/', ctx.L.home, false)] : []),
    ...sectionLinks,
    ...menuPages.map((p) => pageLink(`/${esc(p.slug)}`, p.title, p.slug === page?.slug)),
  ]
    .slice(0, 8)
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
    call || contactHref
      ? `<div class="mbar">${call ? `<a href="${call}">${icon('phone')}${et(ctx, '$theme', 'labels.mobileCall', ctx.labels.mobileCall || ctx.L.callNow)}</a>` : ''}${contactHref ? `<a${call ? ' class="alt"' : ''} href="${contactHref}">${icon('chat')}${et(ctx, '$theme', 'labels.mobileContact', ctx.labels.mobileContact || ctx.L.leaveDetails)}</a>` : ''}</div>`
      : '';
  const hours = hoursSummary(b.openingHours, ctx.lang);
  // In the editor the logo (or its placeholder) is clickable to choose an image (D-076).
  const logoAttr = ei(ctx, '$theme', 'logoAssetId');
  const brand = `${logo ? img(logo, b.name, 'logo', false, logoAttr) : `<span class="mark${opts.editor ? ' mark-empty' : ''}" aria-hidden="true"${logoAttr}>${esc(b.name.trim().charAt(0))}</span>`}<span>${esc(b.name)}</span>`;

  return `${documentHead(draft.theme, seo.title || b.name, seo.description)}
<body${mbar ? ' class="has-mbar"' : ''}>${opts.editor ? editorStyle(ctx.L) : ''}
<nav class="nav" aria-label="${ctx.L.home}"><div class="wrap"><a class="brand" href="/">${brand}</a>${menu ? `<ul class="menu">${menu}</ul>` : ''}${
    // Phones: a script-free menu for multi-page sites (the header menu is hidden there).
    menuPages.length
      ? `<details class="mmenu"><summary aria-label="${ctx.L.menu}">${icon('menu')}</summary><ul>${menu}</ul></details>`
      : ''
  }${call ? `<a class="call" href="${call}"${eb(ctx, 'phone')}>${icon('phone')}<span class="num-text"><bdi dir="ltr">${esc(formatIsraeliPhone(b.phone!))}</bdi></span></a>` : ''}</div></nav>
<main>${html || (opts.editor ? emptyPagePicker(ctx.L) : `<div class="empty">${ctx.L.noSections}</div>`)}</main>
<footer><div class="wrap foot"><div><a class="brand" href="/">${logo ? '' : `<span class="mark" aria-hidden="true">${esc(b.name.trim().charAt(0))}</span>`}${esc(b.name)}</a>${draft.seo.description ? `<p>${esc(draft.seo.description)}</p>` : ''}${
    menuPages.length
      ? `<ul class="foot-pages">${menuPages.map((p) => `<li><a href="/${esc(p.slug)}">${esc(p.title)}</a></li>`).join('')}</ul>`
      : ''
  }</div>
${call || b.address ? `<div><h3>${ctx.L.contactUs}</h3><ul>${call ? `<li${eb(ctx, 'phone')}><a href="${call}"><bdi dir="ltr">${esc(formatIsraeliPhone(b.phone!))}</bdi></a></li>` : ''}${b.address ? `<li${eb(ctx, 'address')}><a href="${mapsHref(b.address)}" target="_blank" rel="noopener">${esc(b.address)}</a></li>` : ''}</ul></div>` : ''}
${hours.length ? `<div${eb(ctx, 'hours')}><h3>${ctx.L.hours}</h3><ul>${hours.map((l) => `<li>${hoursHtml(l)}</li>`).join('')}</ul></div>` : ''}</div>
<div class="bottom"><div class="wrap">© ${esc(b.name)} · ${ctx.L.builtWith}</div></div></footer>
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
