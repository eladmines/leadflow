import { describe, expect, it } from 'vitest';
import { defaultOpeningHours } from './business';
import {
  DEFAULT_CONTACT_FORM,
  saveDraftRequestSchema,
  sectionSchema,
  SECTION_TYPES,
  TEMPLATE_KEYS,
  templateForIndustry,
  type Section,
} from './site';
import { hoursSummary, renderSitePage } from './site-render';
import {
  buildTemplateDraft,
  newPage,
  newSection,
  STOCK_PHOTOS,
  templatePreview,
  type SiteBusinessInfo,
} from './site-templates';

const business: SiteBusinessInfo = {
  name: 'מספרת שירן',
  industry: 'beauty',
  phone: '+972501234567',
  address: 'הרצל 10, חיפה',
  serviceAreas: ['חיפה', 'יקנעם'],
  openingHours: defaultOpeningHours,
};

describe('templates', () => {
  it.each(TEMPLATE_KEYS)('%s draft is valid against the save schema', (key) => {
    const draft = buildTemplateDraft(key, business);
    const parsed = saveDraftRequestSchema.safeParse({ revision: 0, ...draft });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(draft.sections[0]).toMatchObject({ type: 'hero', title: 'מספרת שירן' });
  });

  it('every section type has a valid empty starter', () => {
    for (const type of SECTION_TYPES) {
      expect(sectionSchema.safeParse(newSection(type, `new-${type}`)).success, type).toBe(true);
    }
  });

  it('suggests a template from the industry', () => {
    expect(templateForIndustry('beauty')).toBe('beauty');
    expect(templateForIndustry('studio')).toBe('beauty');
    expect(templateForIndustry('garage')).toBe('garage');
    expect(templateForIndustry('trades')).toBe('trades');
    expect(templateForIndustry('other')).toBe('trades');
  });

  it.each(TEMPLATE_KEYS)('%s preview carries its sample photos on hero and about', (key) => {
    const { draft, media } = templatePreview(key, business);
    const hero = draft.sections.find((s) => s.type === 'hero');
    const about = draft.sections.find((s) => s.type === 'about');
    expect(hero?.type === 'hero' && media[hero.imageAssetId!]?.url).toBe(
      `/media/stock/${STOCK_PHOTOS[key].hero.file}`,
    );
    expect(about?.type === 'about' && about.imageAlt).toBe(STOCK_PHOTOS[key].about.alt);
    expect(renderSitePage(draft, business, media)).toContain('class="hero has-img"');
  });
});

describe('draft validation', () => {
  it('rejects duplicate section ids, unknown types and oversized text', () => {
    const draft = buildTemplateDraft('beauty', business);
    const dup = { ...draft, revision: 0, sections: [draft.sections[0], draft.sections[0]] };
    expect(saveDraftRequestSchema.safeParse(dup).success).toBe(false);
    const bad = { ...draft, revision: 0, sections: [{ id: 'x', type: 'script', visible: true }] };
    expect(saveDraftRequestSchema.safeParse(bad).success).toBe(false);
    const long = {
      ...draft,
      revision: 0,
      sections: [{ ...draft.sections[0], title: 'א'.repeat(121) }],
    };
    expect(saveDraftRequestSchema.safeParse(long).success).toBe(false);
  });
});

describe('renderSitePage', () => {
  it('renders an RTL Hebrew document with SEO, phone and hours', () => {
    const html = renderSitePage(buildTemplateDraft('beauty', business), business);
    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain('<title>מספרת שירן</title>');
    expect(html).toContain('href="tel:+972501234567"');
    expect(html).toContain('050-1234567');
    expect(html).toContain('<caption>שעות פעילות</caption>');
    expect(html).not.toMatch(/<script/i);
  });

  it('escapes user text everywhere (no HTML or attribute injection)', () => {
    const evil = '"><script>alert(1)</script><img src=x onerror=alert(2)>';
    const sections: Section[] = [
      {
        id: 'h',
        type: 'hero',
        visible: true,
        title: evil,
        subtitle: evil,
        buttonLabel: evil,
        buttonAction: 'contact',
        imageAssetId: null,
      },
      {
        id: 'f',
        type: 'faq',
        visible: true,
        title: evil,
        items: [{ question: evil, answer: evil }],
      },
      {
        id: 'c',
        type: 'contact',
        visible: true,
        title: evil,
        subtitle: '',
        showPhone: true,
        showAddress: true,
        showHours: false,
        form: { ...DEFAULT_CONTACT_FORM, successMessage: evil, buttonLabel: evil.slice(0, 40) },
      },
    ];
    const html = renderSitePage(
      {
        theme: { palette: 'teal', font: 'rubik', logoAssetId: null },
        seo: { title: evil, description: evil },
        sections,
      },
      { ...business, name: evil, address: evil },
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toContain('"><script');
    expect(html).not.toContain('onerror=alert(2)>');
    expect(html).toContain('&lt;script&gt;');
    // The address only appears encoded inside the maps URL.
    expect(html).toContain(`query=${encodeURIComponent(evil)}`);
  });

  it('omits hidden sections and links the hero button to the contact section', () => {
    const draft = buildTemplateDraft('beauty', { ...business, phone: null });
    draft.sections = draft.sections.map((s) =>
      s.type === 'testimonials' ? { ...s, visible: false } : s,
    );
    const html = renderSitePage(draft, { ...business, phone: null });
    expect(html).not.toContain('מה הלקוחות מספרים');
    expect(html).toContain('href="#s-contact"');
    expect(html).not.toContain('tel:');
    // Without a phone the mobile bar only offers the contact form.
    expect(html).toContain('<div class="mbar"><a href="#s-contact">');
  });

  it('builds the header menu from visible sections, with a mobile call bar and a rich footer', () => {
    const draft = buildTemplateDraft('beauty', business);
    draft.sections = draft.sections.map((s) => (s.type === 'faq' ? { ...s, visible: false } : s));
    const html = renderSitePage(draft, business);
    const menu = html.match(/<ul class="menu">(.*?)<\/ul>/)?.[1] ?? '';
    expect(menu).toContain('href="#s-services">שירותים<');
    expect(menu).toContain('href="#s-contact">צור קשר<');
    expect(menu).not.toContain('שאלות נפוצות');
    expect(html).toContain('<body class="has-mbar">');
    expect(html).toMatch(/<div class="mbar"><a href="tel:\+972501234567">/);
    expect(html).toContain('<h3>שעות פעילות</h3>');
    // The industry badge drops the explanation in brackets.
    expect(html).toContain('<span class="eyebrow">מספרה וקוסמטיקה</span>');
  });
});

describe('editor markers (D-071)', () => {
  it('mark editable fields only in the editor preview', () => {
    const draft = buildTemplateDraft('beauty', business);
    draft.sections = draft.sections.map((s) => (s.type === 'faq' ? { ...s, visible: true } : s));
    const published = renderSitePage(draft, business);
    expect(published).not.toMatch(/data-edit|data-img|contenteditable/);

    const html = renderSitePage(draft, business, {}, { editor: true });
    expect(html).toContain('<h1 data-edit="hero:title">');
    expect(html).toContain('data-edit="hero:buttonLabel"');
    expect(html).toContain('<h3 data-edit="services:items.1.name" data-ph="שם השירות">');
    expect(html).toContain('data-act="add" data-at="services"');
    expect(html).toContain('data-act="del" data-at="faq:1"');
    expect(published).not.toMatch(/data-act|ed-add/);
    expect(html).toContain('data-edit="about:body" data-multi');
    expect(html).toContain('data-edit="faq:items.1.question"');
    // Every FAQ answer is open in the editor so it can be edited.
    expect(html.match(/<details open data-i>/g)?.length).toBe(2);
  });
});

describe('custom labels (D-075)', () => {
  it("menu, eyebrow, second button and mobile bar use the owner's wording", () => {
    const draft = buildTemplateDraft('beauty', business);
    draft.theme = { ...draft.theme, labels: { mobileCall: 'התקשרו', mobileContact: 'כתבו לנו' } };
    draft.sections = draft.sections.map((s) =>
      s.type === 'services'
        ? { ...s, navLabel: 'טיפולים' }
        : s.type === 'hero'
          ? { ...s, buttonAction: 'call' as const, secondaryLabel: 'השאירו הודעה' }
          : s,
    );
    const html = renderSitePage(draft, business);
    expect(html).toContain('<a href="#s-services">טיפולים</a>');
    expect(html).toContain('<span class="eyebrow"><span>טיפולים</span></span>');
    expect(html).toContain('השאירו הודעה</a>');
    expect(html).toMatch(/התקשרו<\/a>/);
    expect(html).toContain('כתבו לנו</a>');
    expect(html).not.toContain('data-biz');
  });

  it('marks labels and business details in the editor', () => {
    const html = renderSitePage(
      buildTemplateDraft('beauty', business),
      business,
      {},
      { editor: true },
    );
    expect(html).toContain('data-edit="services:navLabel"');
    expect(html).toContain('data-edit="$theme:labels.mobileCall"');
    expect(html).toContain('data-biz="phone"');
    expect(html).toContain('data-biz="hours"');
    expect(html).toContain('data-biz="address"');
    expect(html).toContain(
      'class="mark mark-empty" aria-hidden="true" data-img="$theme:logoAssetId"',
    );
  });
});

describe('pages (D-081)', () => {
  let n = 0;
  const id = () => `x${++n}`;
  const base = () => ({ revision: 0, ...buildTemplateDraft('beauty', business) });

  it('validates page addresses and site-wide unique section ids', () => {
    const about = newPage('about', 'p1', id);
    expect(saveDraftRequestSchema.safeParse({ ...base(), pages: [about] }).success).toBe(true);
    const twice = saveDraftRequestSchema.safeParse({
      ...base(),
      pages: [about, { ...newPage('about', 'p2', id), slug: about.slug }],
    });
    expect(twice.error?.issues[0]?.message).toBe('כבר יש עמוד בכתובת הזו');
    const reserved = saveDraftRequestSchema.safeParse({
      ...base(),
      pages: [{ ...about, slug: 'media' }],
    });
    expect(reserved.success).toBe(false);
    const hebrew = saveDraftRequestSchema.safeParse({
      ...base(),
      pages: [{ ...about, slug: 'אודות' }],
    });
    expect(hebrew.success).toBe(false);
    const clash = saveDraftRequestSchema.safeParse({
      ...base(),
      pages: [{ ...about, sections: [newSection('faq', 'hero')] }], // "hero" is a home section id
    });
    expect(clash.success).toBe(false);
    expect(newPage('about', 'p3', id, ['about']).slug).toBe('about-2');
    // New pages start from the home page's content, with fresh ids.
    const home = buildTemplateDraft('beauty', business).sections;
    const services = newPage('services', 'p4', id, [], home);
    const copied = services.sections.find((x) => x.type === 'services');
    expect(copied?.type === 'services' && copied.items[0]?.name).toBe('תספורת ועיצוב');
    expect(copied?.id).not.toBe('services');
  });

  it('renders the page menu, the current page, and links to the home contact form', () => {
    const draft = buildTemplateDraft('beauty', business);
    draft.pages = [newPage('about', 'p1', id), { ...newPage('landing', 'p2', id), slug: 'sale' }];
    draft.pages[0]!.sections = draft.pages[0]!.sections.filter((s) => s.type !== 'contact');
    const home = renderSitePage(draft, business);
    expect(home).toContain('<a href="/" aria-current="page">ראשי</a>');
    expect(home).toContain('<a href="/about">אודות</a>');
    expect(home).not.toContain('href="/sale"'); // landing pages stay out of the menu
    expect(home).toContain('<details class="mmenu">');

    const about = renderSitePage(draft, business, {}, { page: 'about' });
    expect(about).toContain('<title>אודות · מספרת שירן</title>');
    expect(about).toContain('<a href="/about" aria-current="page">אודות</a>');
    // No form on this page: the call-to-action goes to the home page's form.
    expect(about).toContain('href="/#s-contact"');

    const sale = renderSitePage(draft, business, {}, { page: 'sale' });
    expect(sale).toContain('<input type="hidden" name="_p" value="sale">');
  });
});

describe('section look (D-082)', () => {
  it('renders the chosen background, alignment, spacing, title and button styles', () => {
    const draft = buildTemplateDraft('beauty', business);
    draft.sections = draft.sections.map((s) =>
      s.type === 'services'
        ? { ...s, style: { bg: 'dark', align: 'center', spacing: 'airy', titleSize: 'large' } }
        : s.type === 'hero'
          ? { ...s, style: { bg: 'brand', button: 'outline', titleColor: 'accent' } }
          : s,
    );
    const html = renderSitePage(draft, business);
    expect(html).toContain('<section id="s-services" class="sec-dark al-center sp-airy ts-large">');
    expect(html).toContain('<header class="hero sec-brand tc-accent btn-outline" id="s-hero">');
    // Untouched sections keep the automatic alternation.
    expect(html).toMatch(/<section id="s-pricing" class="soft">/);
  });
});

describe('custom colours (D-083)', () => {
  it('accepts readable main colours, darkens light ones, and renders them', async () => {
    const { customColorsSchema, darkenForContrast, contrastWithWhite } = await import('./site');
    expect(customColorsSchema.safeParse({ primary: '#1d4ed8', accent: '#f59e0b' }).success).toBe(
      true,
    );
    const light = customColorsSchema.safeParse({ primary: '#ffd166', accent: '#000000' });
    expect(light.error?.issues[0]?.message).toMatch(/בהיר מדי/);
    const fixed = darkenForContrast('#ffd166');
    expect(contrastWithWhite(fixed)).toBeGreaterThanOrEqual(4.5);
    const draft = buildTemplateDraft('beauty', business);
    draft.theme = { ...draft.theme, custom: { primary: '#1d4ed8', accent: '#f59e0b' } };
    const html = renderSitePage(draft, business);
    expect(html).toContain('--p:#1d4ed8;--a:#f59e0b;');
  });
});

describe('hoursSummary', () => {
  it('groups consecutive days with the same hours and skips closed days', () => {
    expect(hoursSummary(defaultOpeningHours)).toEqual([
      'ראשון–חמישי 09:00–18:00',
      'שישי 09:00–13:00',
    ]);
    expect(hoursSummary(null)).toEqual([]);
  });
});

describe('subdomain', () => {
  it('normalises and accepts valid names', async () => {
    const { subdomainSchema } = await import('./site');
    expect(subdomainSchema.parse('  Shiran-Salon ')).toBe('shiran-salon');
    expect(subdomainSchema.parse('abc')).toBe('abc');
  });

  it.each(['ab', '-shiran', 'shiran-', 'שירן', 'shi ran', 'a'.repeat(41), 'www', 'admin'])(
    'rejects %j',
    async (name) => {
      const { subdomainSchema } = await import('./site');
      expect(subdomainSchema.safeParse(name).success).toBe(false);
    },
  );
});
