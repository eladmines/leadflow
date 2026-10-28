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
