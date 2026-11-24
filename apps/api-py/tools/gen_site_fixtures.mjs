// Fixtures for tests/test_site_render.py: what the TypeScript builders and renderer produce for a
// broad set of inputs. Run from the repo root:  npx tsx apps/api-py/tools/gen_site_fixtures.mjs
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  buildTemplateDraft,
  withTemplatePhotos,
  renderSitePage,
  renderSiteMessagePage,
  hoursSummary,
  TEMPLATE_KEYS,
} from '../../../packages/shared/src/index.ts';

const hours = (o = {}) => ({
  sun: { open: true, from: '09:00', to: '18:00' },
  mon: { open: true, from: '09:00', to: '18:00' },
  tue: { open: true, from: '09:00', to: '18:00' },
  wed: { open: true, from: '09:00', to: '18:00' },
  thu: { open: true, from: '09:00', to: '16:00' },
  fri: { open: true, from: '09:00', to: '13:00' },
  sat: { open: false, from: '09:00', to: '18:00' },
  ...o,
});
const BUSINESSES = {
  full: {
    name: 'מספרת שירן', industry: 'beauty', phone: '+972501234567', address: 'הרצל 10, חיפה',
    serviceAreas: ['חיפה', 'קריות', 'נשר', 'טירת הכרמל'], openingHours: hours(),
    services: [{ id: '11111111-1111-4111-8111-111111111111', name: 'תספורת' }, { id: '22222222-2222-4222-8222-222222222222', name: 'צבע "מיוחד" <b>' }],
  },
  bare: { name: 'Bare & <Co>', industry: 'other', phone: null, address: null, serviceAreas: [], openingHours: null },
  phoneOnly: { name: 'x', industry: 'garage', phone: '+14155550123', address: null, serviceAreas: [], openingHours: hours({ sat: { open: true, from: '10:00', to: '12:00' } }) },
  areasOnly: { name: "אבי's Garage", industry: 'restaurant', phone: null, address: 'שדרות בן גוריון 5 & 7', serviceAreas: ['תל אביב'], openingHours: null },
  long: { name: 'א'.repeat(100), industry: 'electrician', phone: '+972521112233', address: null, serviceAreas: Array.from({ length: 6 }, (_, i) => `עיר ${i}`), openingHours: null },
};
const MEDIA_IDS = {
  hero: '00000000-0000-4000-8000-0000000000a1',
  about: '00000000-0000-4000-8000-0000000000a2',
  logo: '00000000-0000-4000-8000-0000000000a3',
  g1: '00000000-0000-4000-8000-0000000000b1',
  g2: '00000000-0000-4000-8000-0000000000b2',
  g3: '00000000-0000-4000-8000-0000000000b3',
};
const media = Object.fromEntries(
  Object.entries(MEDIA_IDS).map(([k, id], i) => [id, { url: `/media/b/${k}.webp`, width: 800 + i, height: 600 + i }]),
);
const mediaIds = { hero: MEDIA_IDS.hero, about: MEDIA_IDS.about };

// The stylesheet is the same for every page with the same colours and font: keep it once.
const cssSamples = {};
const STYLE = /<style>([\s\S]*?)<\/style>/;
const cssKey = (css) => {
  const colours = /--p:(#[0-9a-f]{6});--a:(#[0-9a-f]{6});--soft:(#[0-9a-f]{6})/i.exec(css).slice(1, 4).join('|');
  return `${colours}|${/font-family:'([^']+)'/.exec(css)[1]}`;
};
const strip = (html) => {
  const m = STYLE.exec(html);
  cssSamples[cssKey(m[1])] = m[1];
  return html.replace(STYLE, '<style>@CSS@</style>');
};

const builds = [];
const renders = [];
const push = (label, draft, b, page) => {
  const pagesInput = draft.pages ?? [];
  renders.push({
    label,
    draft, b, media, page: page ?? null,
    html: strip(renderSitePage(draft, b, media, page ? { page } : {})),
  });
  void pagesInput;
};

for (const lang of ['he', 'en']) {
  for (const key of TEMPLATE_KEYS) {
    for (const [bname, b] of Object.entries(BUSINESSES)) {
      const draft = buildTemplateDraft(key, b, lang);
      builds.push({ key, lang, b, draft: JSON.parse(JSON.stringify(draft)), withPhotos: JSON.parse(JSON.stringify(withTemplatePhotos(draft, mediaIds))) });
      push(`${lang}/${key}/${bname}`, withTemplatePhotos(draft, mediaIds), b);
      push(`${lang}/${key}/${bname}/nophotos`, draft, b);
    }
  }
}

// Variations on the full beauty draft: styles, colours, labels, pages, gallery, forms.
const base = () => JSON.parse(JSON.stringify(withTemplatePhotos(buildTemplateDraft('beauty', BUSINESSES.full, 'he'), mediaIds)));
const withSection = (draft, type, patch = {}) => draft.sections.find((s) => s.type === type) && Object.assign(draft.sections.find((s) => s.type === type), patch);
const variants = {
  styles: (d) => {
    d.sections[1].style = { bg: 'brand', align: 'center', spacing: 'airy', titleColor: 'accent', titleSize: 'large', button: 'outline' };
    d.sections[2].style = { bg: 'dark', spacing: 'compact', titleColor: 'brand' };
    d.sections[3].style = { bg: 'soft' };
    d.sections[0].style = { bg: 'white', button: 'outline' };
    d.sections.at(-1).style = { bg: 'soft', align: 'center' };
  },
  custom: (d) => { d.theme.custom = { primary: '#123456', accent: '#ff8800' }; d.theme.font = 'frank'; },
  labels: (d) => { d.theme.labels = { mobileCall: 'התקשרו', mobileContact: 'כתבו לנו', cardLink: 'דברו איתנו' }; },
  heroTexts: (d) => { d.sections[0].secondaryLabel = 'שלחו הודעה'; d.sections[0].buttonAction = 'contact'; d.sections[0].imageAssetId = null; },
  noHeroButton: (d) => { d.sections[0].buttonLabel = ''; d.sections[0].subtitle = ''; },
  navLabels: (d) => { d.sections[1].navLabel = 'מה אנחנו עושים'; d.sections[2].navLabel = ''; },
  gallery: (d) => {
    d.sections.splice(2, 0, { id: 'gal', type: 'gallery', visible: true, title: 'גלריה', items: [
      { assetId: MEDIA_IDS.g1, caption: 'ראשונה' }, { assetId: MEDIA_IDS.g2, caption: '' },
      { assetId: MEDIA_IDS.g3, caption: 'שלישית <i>' }, { assetId: '99999999-9999-4999-8999-999999999999', caption: 'חסרה' },
    ] });
  },
  galleryEmpty: (d) => { d.sections.splice(2, 0, { id: 'gal', type: 'gallery', visible: true, title: 'גלריה', items: [{ assetId: '99999999-9999-4999-8999-999999999999', caption: '' }] }); },
  logo: (d) => { d.theme.logoAssetId = MEDIA_IDS.logo; },
  hiddenAndEmpty: (d) => {
    for (const s of d.sections) if (s.type === 'faq') s.visible = true;
    const t = d.sections.find((s) => s.type === 'testimonials'); t.items = [{ quote: '', author: 'x' }, { quote: 'יפה מאוד\n\nשורה שנייה\nושלישית', author: '' }];
    d.sections.find((s) => s.type === 'faq').items = [{ question: '', answer: 'x' }, { question: 'שאלה?', answer: 'תשובה & "ציטוט"' }];
  },
  formVariants: (d) => {
    const c = d.sections.find((s) => s.type === 'contact');
    c.form = { enabled: true, askEmail: false, askMessage: false, buttonLabel: 'שלח <עכשיו>', successMessage: 'תודה', askAppointment: true };
    c.subtitle = '';
  },
  formOff: (d) => { const c = d.sections.find((s) => s.type === 'contact'); c.form.enabled = false; c.showPhone = false; c.showAddress = false; c.showHours = false; },
  noContact: (d) => { d.sections = d.sections.filter((s) => s.type !== 'contact'); },
  noSections: (d) => { d.sections.forEach((s) => (s.visible = false)); },
  noSeo: (d) => { d.seo = { title: '', description: '' }; },
  pages: (d) => {
    d.pages = [
      { id: 'p1', slug: 'about-us', title: 'אודות', inMenu: true, seo: { title: '', description: '' }, sections: [
        { id: 'p1a', type: 'about', visible: true, title: 'הסיפור שלנו', body: 'שורה א\n\nשורה ב', imageAssetId: MEDIA_IDS.about, imageAlt: 'תמונה' },
        { id: 'p1c', type: 'contact', visible: true, title: 'דברו איתנו', subtitle: 'נשמח', showPhone: true, showAddress: true, showHours: true, form: { enabled: true, askEmail: true, askMessage: true, buttonLabel: 'שלח', successMessage: 'תודה', askAppointment: false } },
      ] },
      { id: 'p2', slug: 'prices', title: 'מחירון', inMenu: true, seo: { title: 'מחירים', description: 'כל המחירים' }, sections: [
        { id: 'p2a', type: 'pricing', visible: true, title: 'מחירים', note: 'כולל מע"מ', items: [{ name: 'א', price: '₪1' }] },
      ] },
      { id: 'p3', slug: 'hidden', title: 'מוסתר', inMenu: false, seo: { title: '', description: '' }, sections: [] },
    ];
  },
  manyMenu: (d) => {
    d.pages = Array.from({ length: 6 }, (_, i) => ({ id: `pg${i}`, slug: `pg-${i}`, title: `עמוד ${i}`, inMenu: true, seo: { title: '', description: '' }, sections: [] }));
  },
};
for (const [name, fn] of Object.entries(variants)) {
  for (const [bname, b] of [['full', BUSINESSES.full], ['bare', BUSINESSES.bare], ['phoneOnly', BUSINESSES.phoneOnly]]) {
    const d = base(); fn(d);
    push(`variant/${name}/${bname}`, d, b);
    for (const p of d.pages ?? []) push(`variant/${name}/${bname}/page-${p.slug}`, d, b, p.slug);
  }
  // The same on an English site.
  const e = JSON.parse(JSON.stringify(withTemplatePhotos(buildTemplateDraft('food', BUSINESSES.full, 'en'), mediaIds))); 
  try { fn(e); push(`variant-en/${name}`, e, BUSINESSES.full); } catch { /* the variant does not apply */ }
}

const messages = ['he', 'en'].flatMap((lang) =>
  [
    { title: 'תודה!', text: 'קיבלנו', backLabel: 'חזרה לאתר' },
    { title: 'כמעט', text: 'חסרים פרטים', items: ['שם <חובה>', 'טלפון & עוד'], backLabel: 'חזרה' },
  ].map((page) => {
    const theme = { language: lang, palette: 'navy', font: 'heebo', logoAssetId: null };
    return { theme, b: { name: "Café 'Noa' <b>" }, page, html: strip(renderSiteMessagePage(theme, { name: "Café 'Noa' <b>" }, page)) };
  }),
);
const hoursCases = [null, hours(), hours({ sun: { open: false, from: '09:00', to: '18:00' }, mon: { open: false, from: '09:00', to: '18:00' } }), hours({ sat: { open: true, from: '09:00', to: '18:00' } })]
  .flatMap((h) => ['he', 'en', undefined].map((lang) => ({ hours: h, lang: lang ?? null, lines: hoursSummary(h, lang) })));

writeFileSync(new URL('../tests/fixtures/site_cases.json.gz', import.meta.url).pathname, gzipSync(JSON.stringify({ builds, renders, messages, hoursCases, cssSamples })));
console.log(`builds ${builds.length}, renders ${renders.length}, messages ${messages.length}, hours ${hoursCases.length}`);
